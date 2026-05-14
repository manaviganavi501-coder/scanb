const chatState = {
  isLoading: false,
  // latest scanned product context (set by frontend when scan happens)
  productPayload: null,
  analysis: null,
  // client-side chat history (used for prompt building)
  chatHistory: [],
};


function getChatElements() {
  return {
    section: document.getElementById('chat-section'),
    body: document.getElementById('chat-body'),
    messages: document.getElementById('chat-messages'),
    input: document.getElementById('chat-input'),
    send: document.getElementById('chat-send'),
  };
}

function chatScrollToBottom() {
  const { body } = getChatElements();
  if (!body) return;
  body.scrollTop = body.scrollHeight;
}

function renderMessage({ role, text }) {
  const { messages } = getChatElements();
  if (!messages) return;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'chat-bubble--user' : 'chat-bubble--bot'}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  chatScrollToBottom();
}

function setChatLoading(loading) {
  const { input, send } = getChatElements();
  chatState.isLoading = loading;
  if (input) input.disabled = loading;
  if (send) send.disabled = loading;
}

function safeTrim(s) {
  return String(s ?? '').trim();
}

async function handleUserMessage(message, productData) {
  const { input } = getChatElements();

  // 1) UI STATE MANAGEMENT
  if (chatState.isLoading) return;
  setChatLoading(true);
  chatState.chatHistory.push({ role: 'user', text: message });
  if (input) input.value = '';

  renderMessage({ role: 'user', text: message });
  chatScrollToBottom();

  try {
    // 2) API KEY CHECK (safe/production-ready: backend handles HF key)
    // We rely on backend; if backend is unreachable or fails, we fall back locally.

    // 3) BUILD PROMPT (client-side representation; backend will also build its own)
    const { productPayload, analysis } = productData || {};

    const chatHistoryForPrompt = chatState.chatHistory
      .slice(-12)
      .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
      .join('\n');

    const systemInstruction = 'You are a health assistant. Respond in simplified English.';

    const promptParts = [];
    if (productPayload) promptParts.push(`Product data: ${JSON.stringify(productPayload)}`);
    if (analysis) promptParts.push(`Analysis: ${JSON.stringify(analysis)}`);
    promptParts.push('Chat history:\n' + chatHistoryForPrompt);
    promptParts.push(`User message: ${message}`);

    const prompt = [systemInstruction, ...promptParts].join('\n\n');

    // 4) API REQUEST to backend which calls HuggingFace with timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let botText = '';
    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        mode: 'cors',
        signal: controller.signal,
        body: JSON.stringify({
          message,
          // backend expects this shape
          context: {
            product_payload: productPayload || null,
            analysis: analysis || null,
          },
          // send prompt too (backend may ignore; keeps request modular)
          prompt,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data && data.success && data.reply) {
        botText = String(data.reply);
      } else {
        throw new Error(data?.error || 'Chat API failed');
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (botText) {
      const cleaned = String(botText).replace(/\s+$/g, '');
      chatState.chatHistory.push({ role: 'bot', text: cleaned });
      renderMessage({ role: 'bot', text: cleaned });
      chatScrollToBottom();
      return;
    }

    // 5) HANDLE RESPONSE failure -> fallback
    const fallback = getLocalResponse(message, productData);
    chatState.chatHistory.push({ role: 'bot', text: fallback });
    renderMessage({ role: 'bot', text: fallback });
    chatScrollToBottom();
  } catch (e) {
    // 5) Failure / timeout -> Local fallback engine
    const fallback = getLocalResponse(message, productData);
    chatState.chatHistory.push({ role: 'bot', text: fallback });
    renderMessage({ role: 'bot', text: fallback });
    chatScrollToBottom();
  } finally {
    // 7) FINAL UI UPDATE
    setChatLoading(false);
    if (input) input.focus();
  }
}

function getLocalResponse(message, productData) {
  const { productPayload, analysis } = productData || {};

  // 6) LOCAL FALLBACK ENGINE
  if (!productPayload && !analysis) {
    return 'Please scan an item first';
  }

  const msg = safeTrim(message).toLowerCase();
  const productName = productPayload?.name || 'this product';
  const healthScore = analysis?.health_score ?? productPayload?.health_score;
  const status = analysis?.status ?? productPayload?.status;

  const ingredientDetails = analysis?.ingredient_details || analysis?.ingredient_details || analysis?.ingredientDetails;

  const ingredientLists = {
    safe: ingredientDetails?.safe || [],
    moderate: ingredientDetails?.moderate || [],
    harmful: ingredientDetails?.harmful || [],
  };

  if (/(health|rating)/.test(msg)) {
    const hs = Number.isFinite(Number(healthScore)) ? Number(healthScore) : null;
    const title = `Health Score summary for ${productName}`;
    const lines = [title, ''];
    if (hs !== null) lines.push(`• Health Score: ${hs}/10`);
    if (status) lines.push(`• Status: ${status}`);
    if (ingredientLists.safe.length || ingredientLists.moderate.length || ingredientLists.harmful.length) {
      lines.push('');
      lines.push('Ingredient split (from label parsing):');
      lines.push(`• Safe: ${ingredientLists.safe.length}`);
      lines.push(`• Moderate: ${ingredientLists.moderate.length}`);
      lines.push(`• To limit: ${ingredientLists.harmful.length}`);
    } else {
      lines.push('');
      lines.push('• Ingredient categories are not available; rely on the label grade/status.');
    }
    return lines.join('\n');
  }

  if (/(ingredients|additives)/.test(msg)) {
    const name = productName;
    const safe = ingredientLists.safe;
    const moderate = ingredientLists.moderate;
    const harmful = ingredientLists.harmful;

    const listPreview = (arr) => (Array.isArray(arr) && arr.length ? arr.slice(0, 12).join(', ') : 'None detected');
    return [
      `Ingredient & additive overview for ${name}`,
      '',
      `Safe (often fine): ${listPreview(safe)}`,
      `Moderate (balance): ${listPreview(moderate)}`,
      `To limit: ${listPreview(harmful)}`,
      '',
      harmful?.length ? 'Tip: Consider alternatives with fewer “to limit” ingredients.' : 'Tip: Keep portion sizes and frequency in mind.'
    ].join('\n');
  }

  if (/(nutrition|sugar|calories|energy|protein|carb|carbohydrate|fat|sodium)/.test(msg)) {
    const n = productPayload?.nutrients || {};
    const pick = (aliases) => {
      for (const k of aliases) {
        const v = n[k];
        if (v !== undefined && v !== null && v !== '' && v !== 'Not available') return v;
      }
      return null;
    };

    const rows = [
      ['Energy (kcal)', pick(['energy-kcal_100g', 'energy-kcal', 'energy_100g', 'energy'])],
      ['Protein (g)', pick(['proteins_100g', 'proteins'])],
      ['Carbohydrates (g)', pick(['carbohydrates_100g', 'carbohydrates'])],
      ['Total Fat (g)', pick(['fat_100g', 'fats', 'fat'])],
      ['Saturated Fat (g)', pick(['saturated-fat_100g', 'saturated_fat', 'saturated-fat'])],
      ['Sugars (g)', pick(['sugars_100g', 'sugars'])],
      ['Sodium (mg)', pick(['sodium_100g', 'sodium'])],
    ];

    const header = ['| Nutrient | Value |', '|---|---|'].join('\n');
    const body = rows
      .map(([label, v]) => `| ${label} | ${v ?? '—'} |`)
      .join('\n');

    return [`Nutrition table for ${productName} (Per 100g)`, '', header, body].join('\n');
  }

  // Else: general product overview
  const hs = Number.isFinite(Number(healthScore)) ? Number(healthScore) : null;
  return [
    `Product overview for ${productName}`,
    '',
    hs !== null ? `• Health Score: ${hs}/10` : '• Health Score: not available',
    status ? `• Status: ${status}` : '',
    '',
    'Ask about:',
    '• health / rating',
    '• ingredients / additives',
    '• nutrition / sugar / calories',
  ].filter(Boolean).join('\n');
}

async function sendChatMessage() {
  const { input } = getChatElements();
  if (!input) return;

  const message = safeTrim(input.value);
  if (!message) return;

  input.value = '';

  await handleUserMessage(message, {
    productPayload: chatState.productPayload,
    analysis: chatState.analysis,
  });
}


function attachChatHandlers() {
  const { input, send, section } = getChatElements();
  if (!section || !input || !send) return;

  send.addEventListener('click', () => sendChatMessage());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  });


  // Initial greeting
  renderMessage({
    role: 'bot',
    text: "Hi! Scan an item first, then ask me: health rating, ingredients/additives, or nutrition/sugar/calories.",
  });
}

function setChatContextFromScan(product, analysis) {
  chatState.productPayload = product || null;
  chatState.analysis = analysis || null;
}

// Export for app.js to call
window.__chatbot_ui = {
  attachChatHandlers,
  setChatContextFromScan,
};

