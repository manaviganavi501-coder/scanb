const API_BASE = window.BARCODIFY_API_BASE || (
    window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'http://127.0.0.1:5000'
);

const resultsSection = document.getElementById('results');
const loadingOverlay = document.getElementById('loading-overlay');
const historyList = document.getElementById('history-list');
let latestAlternativesRequest = 0;
let currentAlternatives = [];
let alternativesExpanded = false;

const HARMFUL_INGREDIENTS = [
    'hydrogenated oil',
    'partially hydrogenated oil',
    'high fructose corn syrup',
    'sucralose',
    'aspartame',
    'saccharin',
    'tartrazine',
    'sunset yellow',
    'sodium benzoate',
    'potassium sorbate',
    'tbhq',
    'bha',
    'bht',
    'flavour enhancer',
    'flavor enhancer',
    'ins ',
    'e621',
    'e627',
    'e631'
];

const MODERATE_INGREDIENTS = [
    'palm oil',
    'sugar',
    'salt',
    'sodium',
    'wheat',
    'maida',
    'gluten',
    'soy',
    'milk',
    'lactose'
];

document.addEventListener('DOMContentLoaded', function() {
    loadHistory();

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            document.getElementById(targetId).scrollIntoView({ behavior: 'smooth' });
        });
    });

    const alternativeModal = document.getElementById('alternative-modal');
    alternativeModal?.addEventListener('click', (event) => {
        if (event.target === alternativeModal) {
            closeAlternativeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAlternativeModal();
        }
    });
});

async function searchBarcode(barcode) {
    showLoading(true);
    stopScanner();

    const scannerSection = document.getElementById('scanner');
    if (!scannerSection.classList.contains('hidden')) {
        toggleScanner();
    }

    try {
        const response = await fetch(`${API_BASE}/product/${barcode}`, { mode: 'cors' });
        const data = await response.json();

        if (response.ok && data.success) {
            displayProduct(data);
            resultsSection.classList.remove('hidden');
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            showError(data.message || 'Product not found');
        }
    } catch (error) {
        console.error('Search error:', error);
        showError(`Backend is not reachable at ${API_BASE}. Start the Flask server, then try again.`);
    } finally {
        showLoading(false);
    }
}

function displayProduct(data) {
    const product = data.product;
    const analysis = data.analysis;
    const nutrients = product.nutrients || {};
    const ingredients = parseIngredients(product.ingredients);
    const serverIngredientGroups = normalizeIngredientDetails(analysis.ingredient_details);
    const ingredientGroups = hasIngredientDetails(serverIngredientGroups)
        ? serverIngredientGroups
        : groupIngredients(ingredients);
    const ingredientList = ingredients.length ? ingredients : flattenIngredientGroups(ingredientGroups);

    if (typeof renderNutritionChart === 'function') {
        renderNutritionChart({
            proteins: product.proteins,
            carbohydrates: product.carbohydrates,
            fats: product.fats,
            energy: getNutrient(nutrients, ['energy-kcal_100g', 'energy-kcal']) || product.energy,
        });
    }

    document.getElementById('product-name').textContent = product.name || 'Unknown Product';
    document.getElementById('product-brand').textContent = product.brand || 'Unknown Brand';
    document.getElementById('category').textContent = product.category || 'Not available';
    document.getElementById('barcode').textContent = product.barcode || 'Not available';

    const productImage = document.getElementById('product-image');
    productImage.src = product.image || 'https://via.placeholder.com/280x280/f8fafc/64748b?text=No+Image';
    productImage.onerror = function() {
        this.src = 'https://via.placeholder.com/280x280/f8fafc/64748b?text=No+Image';
    };

    setNutritionValue('energy', getNutrient(nutrients, ['energy-kcal_100g', 'energy-kcal']) || product.energy, 'kcal');
    setNutritionValue('proteins', product.proteins, 'g');
    setNutritionValue('carbohydrates', product.carbohydrates, 'g');
    setNutritionValue('fats', product.fats, 'g');
    setNutritionValue('saturated-fat', getNutrient(nutrients, ['saturated-fat_100g', 'saturated-fat']), 'g');
    setNutritionValue('sugars', getNutrient(nutrients, ['sugars_100g', 'sugars']), 'g');
    setNutritionValue('sodium', getNutrient(nutrients, ['sodium_100g', 'sodium']), 'mg', 1000);

    updateScore(analysis.health_score, analysis.status, product.nutrition_grade);
    displayIngredientChips(ingredientList);
    displayIngredientAnalysis(ingredientGroups, analysis.ingredient_analysis);
    displayWarnings(analysis.warnings, ingredientGroups);
    displayAlternatives(product);
}

function parseIngredients(text) {
    if (!text || text === 'Not available') {
        return [];
    }

    return text
        .replace(/[()[\]{}]/g, ',')
        .split(/[,;•]|\.(?=\s+[A-Z])|\n+/)
        .map(item => item.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 16);
}

function normalizeIngredientDetails(details) {
    return {
        safe: Array.isArray(details?.safe) ? details.safe.filter(Boolean) : [],
        moderate: Array.isArray(details?.moderate) ? details.moderate.filter(Boolean) : [],
        limit: Array.isArray(details?.harmful) ? details.harmful.filter(Boolean) : []
    };
}

function hasIngredientDetails(groups) {
    return groups.safe.length || groups.moderate.length || groups.limit.length;
}

function flattenIngredientGroups(groups) {
    return [...groups.safe, ...groups.moderate, ...groups.limit];
}

function classifyIngredient(name) {
    const lower = name.toLowerCase();
    if (HARMFUL_INGREDIENTS.some(term => lower.includes(term))) {
        return 'limit';
    }
    if (MODERATE_INGREDIENTS.some(term => lower.includes(term))) {
        return 'moderate';
    }
    return 'safe';
}

function groupIngredients(ingredients) {
    return ingredients.reduce((groups, ingredient) => {
        groups[classifyIngredient(ingredient)].push(ingredient);
        return groups;
    }, { safe: [], moderate: [], limit: [] });
}

function displayIngredientChips(ingredients) {
    const container = document.getElementById('ingredient-chips');
    const items = ingredients.length ? ingredients : ['Ingredients not listed'];

    container.innerHTML = items.map(ingredient => {
        const type = ingredients.length ? classifyIngredient(ingredient) : 'unknown';
        return `<span class="ingredient-chip ingredient-chip--${type}">${escapeHtml(ingredient)}</span>`;
    }).join('');
}

function displayIngredientAnalysis(groups, counts) {
    const container = document.getElementById('ingredient-breakdown');
    const safe = groups.safe.length ? groups.safe : fallbackCount('Safe ingredients', counts?.safe);
    const moderate = groups.moderate.length ? groups.moderate : fallbackCount('Moderate ingredients', counts?.moderate);
    const limit = groups.limit.length ? groups.limit : fallbackCount('Ingredients to limit', counts?.harmful);

    container.innerHTML = [
        analysisRow('safe', 'Safe Ingredients', safe),
        analysisRow('moderate', 'Moderate Ingredients', moderate),
        analysisRow('limit', 'Ingredients to Limit', limit)
    ].join('');
}

function analysisRow(type, label, items) {
    const text = items.length ? items.map(escapeHtml).join(', ') : 'None detected';
    const icon = type === 'safe' ? 'OK' : type === 'moderate' ? '!' : 'X';

    return `
        <button class="ingredient-analysis-row ingredient-analysis-row--${type}" type="button">
            <span class="analysis-icon">${icon}</span>
            <strong>${label}</strong>
            <span>${text}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
    `;
}

function fallbackCount(label, count) {
    if (!count) {
        return [];
    }
    return [`${count} ${label.toLowerCase()}`];
}

function displayWarnings(warnings, groups) {
    const container = document.getElementById('warnings-list');
    const warningText = buildInsightText(warnings, groups);
    const tone = groups.limit.length ? 'limit' : groups.moderate.length ? 'moderate' : 'safe';

    container.innerHTML = `
        <div class="result-insight result-insight--${tone}">
            <span class="analysis-icon">${tone === 'safe' ? 'OK' : 'i'}</span>
            <span>${escapeHtml(warningText)}</span>
        </div>
    `;
}

function buildInsightText(warnings, groups) {
    if (groups.limit.length) {
        return `Contains ingredients to limit: ${groups.limit.slice(0, 3).join(', ')}. Not recommended for regular consumption.`;
    }
    if (warnings && warnings.length) {
        return warnings.slice(0, 3).join(', ');
    }
    if (groups.moderate.length) {
        return `Contains moderate ingredients: ${groups.moderate.slice(0, 3).join(', ')}. Best consumed occasionally.`;
    }
    return 'No major ingredient warnings detected from the available label data.';
}

function updateScore(score, status, grade) {
    const normalizedScore = Number.isFinite(Number(score)) ? Number(score) : 0;
    const scoreRing = document.getElementById('score-ring');
    const statusClass = getStatusClass(normalizedScore, status);
    const statusLabel = cleanStatus(status, normalizedScore);
    const summary = getScoreSummary(normalizedScore);

    document.getElementById('score-number').textContent = normalizedScore.toFixed(normalizedScore % 1 ? 1 : 0);
    document.getElementById('product-status').textContent = statusLabel;
    document.getElementById('product-status').className = `status-badge status-${statusClass}`;
    document.getElementById('score-summary').textContent = summary;

    scoreRing.style.setProperty('--score-angle', `${Math.max(0, Math.min(10, normalizedScore)) * 36}deg`);
    scoreRing.className = `score-ring score-ring--${statusClass}`;

    const gradeElement = document.getElementById('nutrition-grade');
    const normalizedGrade = (grade || 'unknown').toString().toLowerCase();
    gradeElement.textContent = (grade || 'Unknown').toString().toUpperCase();
    gradeElement.className = `nutrition-grade grade-${normalizedGrade}`;
}

function getStatusClass(score, status) {
    const value = (status || '').toLowerCase();
    if (value.includes('healthy') || score >= 8) return 'healthy';
    if (value.includes('avoid') || score < 5) return 'avoid';
    return 'moderate';
}

function cleanStatus(status, score) {
    if (status && status.toLowerCase().includes('healthy')) return 'Healthy';
    if (status && status.toLowerCase().includes('avoid')) return 'Limit';
    if (status && status.toLowerCase().includes('moderate')) return 'Average';
    if (score >= 8) return 'Healthy';
    if (score >= 5) return 'Average';
    return 'Limit';
}

function getScoreSummary(score) {
    if (score >= 8) {
        return 'This product looks like a stronger everyday choice.';
    }
    if (score >= 5) {
        return 'This product is okay occasionally. Consider healthier alternatives.';
    }
    return 'This product is best limited. Check the label before buying regularly.';
}

function getNutrient(nutrients, keys) {
    for (const key of keys) {
        if (nutrients[key] !== undefined && nutrients[key] !== null && nutrients[key] !== '') {
            return nutrients[key];
        }
    }
    return null;
}

function setNutritionValue(id, value, unit, multiplier = 1) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = formatAmount(value, unit, multiplier);
}

function formatAmount(value, unit, multiplier = 1) {
    const number = Number(value);
    if (value === undefined || value === null || value === '' || value === 'Not available' || Number.isNaN(number)) {
        return 'Not available';
    }
    const adjusted = number * multiplier;
    const rounded = adjusted >= 100 ? Math.round(adjusted) : Math.round(adjusted * 10) / 10;
    return `${rounded} ${unit}`;
}

async function displayAlternatives(product) {
    const container = document.getElementById('alternatives-list');
    const viewAllButton = document.getElementById('view-all-alternatives');
    const requestId = ++latestAlternativesRequest;
    const category = product?.category || 'Unknown';
    const excludeBarcode = product?.barcode || '';
    const params = new URLSearchParams({
        name: product?.name || '',
        brand: product?.brand || '',
        ingredients: product?.ingredients || ''
    });

    container.innerHTML = '<p class="empty-state">Finding better products...</p>';
    if (viewAllButton) {
        viewAllButton.classList.add('hidden');
        viewAllButton.textContent = 'View All';
    }

    try {
        const resp = await fetch(`${API_BASE}/alternatives/${encodeURIComponent(category)}/${encodeURIComponent(excludeBarcode)}?${params.toString()}`, { mode: 'cors' });
        const data = await resp.json();
        if (requestId !== latestAlternativesRequest) {
            return;
        }

        const alternatives = data.alternatives || [];
        currentAlternatives = alternatives;
        alternativesExpanded = false;

        renderAlternatives();

        if (viewAllButton && currentAlternatives.length > 3) {
            viewAllButton.classList.remove('hidden');
        }
    } catch (error) {
        if (requestId !== latestAlternativesRequest) {
            return;
        }

        console.error('Alternatives error:', error);
        container.innerHTML = '<p class="empty-state">Alternatives could not be loaded.</p>';
    }
}

function renderAlternatives() {
    const container = document.getElementById('alternatives-list');
    const viewAllButton = document.getElementById('view-all-alternatives');
    if (!container) return;

    const visibleAlternatives = alternativesExpanded
        ? currentAlternatives
        : currentAlternatives.slice(0, 3);

    container.innerHTML = visibleAlternatives.map((alt, index) => alternativeCard(alt, index)).join('');

    if (!container.innerHTML) {
        container.innerHTML = '<p class="empty-state">No alternatives available yet.</p>';
    }

    if (viewAllButton) {
        viewAllButton.textContent = alternativesExpanded ? 'Show Less' : 'View All';
        viewAllButton.classList.toggle('hidden', currentAlternatives.length <= 3);
    }
}

function toggleAlternativesView() {
    alternativesExpanded = !alternativesExpanded;
    renderAlternatives();
}

function alternativeCard(alt, index) {
    const imagePalette = ['#2fbf5a', '#8b5e3c', '#111827'];
    const grade = (alt.nutrition_grade || 'A').toString().toUpperCase();
    const score = alt.health_score || 8;
    const fallbackImage = productImageDataUri(alt, index);
    const image = alt.barcode && alt.image ? alt.image : fallbackImage;

    return `
        <div class="alternative-card">
            <div class="alternative-thumb" style="--thumb-color: ${imagePalette[index % imagePalette.length]}">
                <img src="${escapeHtml(image)}" alt="${escapeHtml(alt.name || 'Alternative product')}" loading="lazy" data-fallback-image="${escapeHtml(fallbackImage)}" onerror="this.onerror=null; this.src=this.dataset.fallbackImage;">
            </div>
            <div class="alternative-copy">
                <div class="alternative-name">${escapeHtml(alt.name || 'Alternative Product')}</div>
                <div class="alternative-score">Health Score ${escapeHtml(score)}/10</div>
                <div class="alternative-brand">${escapeHtml(alt.brand || 'Unknown brand')}</div>
            </div>
            <div class="alternative-grade grade-${grade.toLowerCase()}">${escapeHtml(grade)}</div>
            <button type="button" class="alternative-btn" onclick="openAlternativeModal(${index})">View Product</button>
        </div>
    `;
}

function openAlternativeModal(index) {
    const alternative = currentAlternatives[index];
    const modal = document.getElementById('alternative-modal');
    const modalBody = document.getElementById('alternative-modal-body');

    if (!alternative || !modal || !modalBody) {
        return;
    }

    modalBody.innerHTML = alternativeModalContent(alternative);
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeAlternativeModal() {
    const modal = document.getElementById('alternative-modal');
    if (!modal || modal.classList.contains('hidden')) {
        return;
    }

    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
}

function alternativeModalContent(alt) {
    const grade = (alt.nutrition_grade || 'A').toString().toUpperCase();
    const score = Number(alt.health_score || 0);
    const details = ensureAlternativeDetails(alt);
    const fallbackImage = productImageDataUri(alt, 0, true);
    const image = alt.barcode && alt.image ? alt.image : fallbackImage;
    const ingredients = parseIngredients(details.ingredients).slice(0, 10);
    const ingredientGroups = groupIngredients(ingredients);
    const storeRows = buildStoreRows(alt);

    return `
        <div class="alternative-detail">
            <div class="alternative-detail-hero">
                <div class="alternative-detail-image-panel">
                    <img src="${escapeHtml(image)}" alt="${escapeHtml(alt.name || 'Alternative product')}" data-fallback-image="${escapeHtml(fallbackImage)}" onerror="this.onerror=null; this.src=this.dataset.fallbackImage;">
                </div>

                <div class="alternative-detail-main">
                    <h2 id="alternative-modal-title">${escapeHtml(alt.name || 'Alternative Product')}</h2>
                    <p>Brand: ${escapeHtml(alt.brand || 'Unknown brand')}</p>
                    <p>Category: ${escapeHtml(alt.category || 'Better alternative')}</p>
                    <p>Barcode: <strong>${escapeHtml(alt.barcode || 'Suggested product')}</strong></p>

                    <div class="alternative-detail-score">
                        <div class="modal-score-ring ${score >= 8 ? 'modal-score-ring--healthy' : score < 5 ? 'modal-score-ring--avoid' : ''}" style="--modal-score-angle: ${Math.max(0, Math.min(10, score)) * 36}deg">
                            <div>
                                <strong>${escapeHtml(formatScore(score))}</strong>
                                <span>/ 10</span>
                            </div>
                        </div>
                        <div>
                            <strong class="modal-score-status">${escapeHtml(cleanStatus(alt.status, score))}</strong>
                            <p>${escapeHtml(alt.summary || getScoreSummary(score))}</p>
                            <span class="alternative-grade grade-${grade.toLowerCase()}">${escapeHtml(grade)}</span>
                        </div>
                    </div>
                </div>

                <aside class="buy-panel">
                    <h3>Buy From</h3>
                    ${storeRows}
                    <p class="buy-note">
                        <span class="info-dot">i</span>
                        Links open product searches on each store.
                    </p>
                </aside>
            </div>

            <div class="alternative-detail-grid">
                <section class="detail-panel">
                    <h3>Nutrition <span>(Per 100g)</span></h3>
                    <dl class="modal-nutrition-list">
                        ${nutritionRows(details.nutrients)}
                    </dl>
                </section>

                <section class="detail-panel">
                    <h3>Ingredients</h3>
                    <div class="modal-ingredient-chips">
                        ${(ingredients.length ? ingredients : ['Ingredients not listed']).map(item => {
                            const type = ingredients.length ? classifyIngredient(item) : 'unknown';
                            return `<span class="ingredient-chip ingredient-chip--${type}">${escapeHtml(item)}</span>`;
                        }).join('')}
                    </div>
                </section>
            </div>

            <section class="modal-analysis">
                ${analysisTile('safe', 'Safe Ingredients', ingredientGroups.safe)}
                ${analysisTile('moderate', 'Moderate Ingredients', ingredientGroups.moderate)}
                ${analysisTile('limit', 'Ingredients to Limit', ingredientGroups.limit)}
            </section>

            <div class="result-insight result-insight--safe">
                <span class="analysis-icon">i</span>
                <span>${escapeHtml(alt.summary || 'This product is a healthier alternative for the scanned item.')}</span>
            </div>
        </div>
    `;
}

function nutritionRows(nutrients = {}) {
    const rows = [
        ['Energy', formatAmount(nutrients.energy, 'kcal')],
        ['Protein', formatAmount(nutrients.proteins, 'g')],
        ['Carbohydrates', formatAmount(nutrients.carbohydrates, 'g')],
        ['Total Fat', formatAmount(nutrients.fats, 'g')],
        ['Saturated Fat', formatAmount(nutrients.saturated_fat, 'g')],
        ['Sugars', formatAmount(nutrients.sugars, 'g')],
        ['Sodium', formatAmount(nutrients.sodium, 'mg', 1000)]
    ];

    return rows.map(([label, value]) => `
        <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
        </div>
    `).join('');
}

function analysisTile(type, label, items) {
    const icon = type === 'safe' ? 'OK' : type === 'moderate' ? '!' : 'X';
    const text = items.length ? items.slice(0, 5).join(', ') : 'None';

    return `
        <article class="modal-analysis-tile modal-analysis-tile--${type}">
            <span class="analysis-icon">${icon}</span>
            <div>
                <h4>${escapeHtml(label)}</h4>
                <p>${escapeHtml(text)}</p>
            </div>
        </article>
    `;
}

function buildStoreRows(alt) {
    const query = encodeURIComponent(`${alt.name || ''} ${alt.brand || ''}`.trim());
    const stores = [
        ['amazon.in', `https://www.amazon.in/s?k=${query}`],
        ['Flipkart', `https://www.flipkart.com/search?q=${query}`],
        ['bigbasket', `https://www.bigbasket.com/ps/?q=${query}`],
        ['zepto', `https://www.zeptonow.com/search?query=${query}`]
    ];

    return stores.map(([store, url]) => `
        <div class="store-row">
            <strong class="store-logo store-logo--${store.toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(store)}</strong>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
                View Product
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 17 17 7" />
                    <path d="M9 7h8v8" />
                </svg>
            </a>
        </div>
    `).join('');
}

function formatScore(score) {
    return score.toFixed(score % 1 ? 1 : 0);
}

function ensureAlternativeDetails(alt) {
    const fallbackIngredients = fallbackIngredientsForProduct(alt);
    const ingredients = alt.ingredients && alt.ingredients.trim()
        ? alt.ingredients
        : fallbackIngredients;
    const fallbackNutrients = fallbackNutrientsForProduct(alt);
    const nutrients = { ...fallbackNutrients, ...(alt.nutrients || {}) };

    Object.keys(nutrients).forEach(key => {
        if (nutrients[key] === undefined || nutrients[key] === null || nutrients[key] === '' || nutrients[key] === 'Not available') {
            nutrients[key] = fallbackNutrients[key];
        }
    });

    return { ingredients, nutrients };
}

function fallbackIngredientsForProduct(product = {}) {
    const context = `${product.name || ''} ${product.category || ''}`.toLowerCase();

    if (hasAny(context, ['noodle', 'pasta', 'macaroni'])) {
        return 'Whole wheat flour, millet flour, dehydrated vegetables, iodized salt, spices, natural antioxidants';
    }
    if (hasAny(context, ['chocolate', 'cocoa', 'cacao'])) {
        return 'Cocoa solids, cocoa butter, dates, nuts, natural vanilla, minimal cane sugar';
    }
    if (hasAny(context, ['biscuit', 'cookie', 'cracker'])) {
        return 'Whole wheat flour, oats, ragi flour, edible vegetable oil, jaggery, raising agent, iodized salt';
    }
    if (hasAny(context, ['chips', 'makhana', 'chana', 'puffs'])) {
        return 'Roasted makhana, roasted chana, millet flour, spices, iodized salt, cold pressed oil';
    }
    if (hasAny(context, ['cereal', 'muesli', 'granola', 'oats'])) {
        return 'Rolled oats, ragi flakes, nuts, seeds, dried fruit, cinnamon';
    }
    if (hasAny(context, ['drink', 'juice', 'water'])) {
        return 'Water, fruit extract, lemon juice, natural minerals';
    }
    if (hasAny(context, ['yogurt', 'curd', 'dairy', 'milk'])) {
        return 'Milk solids, live cultures, natural dairy proteins';
    }
    if (hasAny(context, ['sauce', 'ketchup', 'spread', 'jam'])) {
        return 'Tomato pulp, dates, vinegar, spices, iodized salt';
    }

    return 'Whole food ingredients, grains, nuts, seeds, natural seasoning';
}

function fallbackNutrientsForProduct(product = {}) {
    const context = `${product.name || ''} ${product.category || ''}`.toLowerCase();

    if (hasAny(context, ['noodle', 'pasta', 'macaroni'])) {
        return { energy: 350, proteins: 12, carbohydrates: 65, fats: 3.5, saturated_fat: 1.2, sugars: 2, sodium: 0.4 };
    }
    if (hasAny(context, ['chocolate', 'cocoa', 'cacao'])) {
        return { energy: 510, proteins: 7, carbohydrates: 42, fats: 36, saturated_fat: 20, sugars: 18, sodium: 0.05 };
    }
    if (hasAny(context, ['biscuit', 'cookie', 'cracker'])) {
        return { energy: 430, proteins: 8, carbohydrates: 68, fats: 14, saturated_fat: 5, sugars: 14, sodium: 0.35 };
    }
    if (hasAny(context, ['chips', 'makhana', 'chana', 'puffs'])) {
        return { energy: 390, proteins: 14, carbohydrates: 58, fats: 9, saturated_fat: 1.8, sugars: 3, sodium: 0.3 };
    }
    if (hasAny(context, ['drink', 'juice', 'water'])) {
        return { energy: 35, proteins: 0, carbohydrates: 8, fats: 0, saturated_fat: 0, sugars: 6, sodium: 0.02 };
    }
    if (hasAny(context, ['yogurt', 'curd', 'dairy', 'milk'])) {
        return { energy: 80, proteins: 8, carbohydrates: 6, fats: 3, saturated_fat: 1.8, sugars: 4, sodium: 0.08 };
    }

    return { energy: 260, proteins: 8, carbohydrates: 38, fats: 7, saturated_fat: 1.5, sugars: 7, sodium: 0.22 };
}

function hasAny(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
}

function productImageDataUri(product, index = 0, large = false) {
    const name = product?.name || 'Better Choice';
    const brand = product?.brand || 'Barcodify Picks';
    const category = product?.category || '';
    const grade = (product?.nutrition_grade || 'A').toString().toUpperCase();
    const palette = productVisualPalette(`${name} ${category}`, index);
    const width = large ? 420 : 240;
    const height = large ? 520 : 320;
    const packX = large ? 92 : 48;
    const packY = large ? 56 : 36;
    const packW = large ? 236 : 144;
    const packH = large ? 380 : 235;
    const titleLines = wrapWords(name, large ? 17 : 12, 3);
    const brandLines = wrapWords(brand, large ? 18 : 14, 1);
    const titleStart = packY + (large ? 170 : 104);
    const titleGap = large ? 31 : 22;
    const brandY = packY + packH - (large ? 54 : 33);
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#e5edf5"/>
    </linearGradient>
    <linearGradient id="pack" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.primary}"/>
      <stop offset="1" stop-color="${palette.secondary}"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#0f172a" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="${large ? 28 : 20}" fill="url(#bg)"/>
  <ellipse cx="${width / 2}" cy="${height - (large ? 48 : 28)}" rx="${large ? 118 : 70}" ry="${large ? 20 : 12}" fill="#0f172a" opacity="0.13"/>
  <path d="M${packX + 10} ${packY} H${packX + packW - 10} Q${packX + packW + 7} ${packY + 38} ${packX + packW - 5} ${packY + packH} H${packX + 5} Q${packX - 7} ${packY + 38} ${packX + 10} ${packY}Z" fill="url(#pack)" filter="url(#shadow)"/>
  <path d="M${packX + 18} ${packY + 16} H${packX + packW - 18}" stroke="#ffffff" stroke-width="${large ? 5 : 3}" opacity="0.36"/>
  <path d="M${packX + 18} ${packY + packH - 18} H${packX + packW - 18}" stroke="#0f172a" stroke-width="${large ? 5 : 3}" opacity="0.16"/>
  <rect x="${packX + (large ? 38 : 23)}" y="${packY + (large ? 62 : 38)}" width="${large ? 160 : 98}" height="${large ? 82 : 52}" rx="${large ? 18 : 12}" fill="#ffffff" opacity="0.9"/>
  <text x="${width / 2}" y="${packY + (large ? 95 : 70)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${large ? 34 : 22}" font-weight="800" fill="${palette.primary}">${escapeSvg(grade)}</text>
  <circle cx="${packX + packW - (large ? 44 : 27)}" cy="${packY + (large ? 48 : 29)}" r="${large ? 17 : 10}" fill="#ffffff" opacity="0.86"/>
  <path d="${foodIconPath(category || name, packX + packW / 2, packY + (large ? 245 : 154), large ? 54 : 34)}" fill="#ffffff" opacity="0.24"/>
  ${titleLines.map((line, lineIndex) => `<text x="${width / 2}" y="${titleStart + lineIndex * titleGap}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${large ? 24 : 16}" font-weight="800" fill="#ffffff">${escapeSvg(line)}</text>`).join('')}
  ${brandLines.map((line) => `<text x="${width / 2}" y="${brandY}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${large ? 18 : 12}" font-weight="700" fill="#ffffff" opacity="0.88">${escapeSvg(line)}</text>`).join('')}
</svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function productVisualPalette(text, index) {
    const lower = text.toLowerCase();
    const palettes = [
        { primary: '#16a34a', secondary: '#86efac' },
        { primary: '#92400e', secondary: '#f59e0b' },
        { primary: '#1d4ed8', secondary: '#93c5fd' },
        { primary: '#be123c', secondary: '#fb7185' },
        { primary: '#6d28d9', secondary: '#c4b5fd' },
        { primary: '#0f766e', secondary: '#5eead4' }
    ];

    if (lower.includes('chocolate') || lower.includes('cocoa')) return { primary: '#5b2c1a', secondary: '#c08457' };
    if (lower.includes('noodle') || lower.includes('pasta')) return { primary: '#15803d', secondary: '#bbf7d0' };
    if (lower.includes('biscuit') || lower.includes('cookie')) return { primary: '#b45309', secondary: '#fde68a' };
    if (lower.includes('juice') || lower.includes('water') || lower.includes('drink')) return { primary: '#0369a1', secondary: '#7dd3fc' };
    if (lower.includes('yogurt') || lower.includes('milk') || lower.includes('curd')) return { primary: '#2563eb', secondary: '#dbeafe' };
    if (lower.includes('chips') || lower.includes('makhana') || lower.includes('chana')) return { primary: '#ca8a04', secondary: '#fef08a' };

    return palettes[index % palettes.length];
}

function wrapWords(value, maxLength, maxLines) {
    const words = String(value || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach(word => {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxLength && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    });

    if (current) {
        lines.push(current);
    }

    return (lines.length ? lines : ['Better Choice']).slice(0, maxLines);
}

function foodIconPath(text, cx, cy, size) {
    const lower = text.toLowerCase();
    if (lower.includes('drink') || lower.includes('juice') || lower.includes('water')) {
        return `M${cx - size * 0.42} ${cy - size * 0.5} H${cx + size * 0.42} L${cx + size * 0.26} ${cy + size * 0.5} H${cx - size * 0.26} Z`;
    }
    if (lower.includes('bar') || lower.includes('chocolate')) {
        return `M${cx - size * 0.52} ${cy - size * 0.32} H${cx + size * 0.52} V${cy + size * 0.32} H${cx - size * 0.52} Z`;
    }
    return `M${cx} ${cy - size * 0.55} C${cx + size * 0.55} ${cy - size * 0.55} ${cx + size * 0.65} ${cy + size * 0.15} ${cx} ${cy + size * 0.55} C${cx - size * 0.65} ${cy + size * 0.15} ${cx - size * 0.55} ${cy - size * 0.55} ${cx} ${cy - size * 0.55} Z`;
}

function escapeSvg(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function loadHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`, { mode: 'cors' });
        const data = await response.json();
        const container = document.getElementById('history-list');

        if (!data.history.length) {
            container.innerHTML = '<p style="text-align: center; color: #64748b; grid-column: 1/-1;">No scan history yet. Start scanning!</p>';
            return;
        }

        container.innerHTML = data.history.map(item => `
            <div class="history-item">
                <div class="history-name">${escapeHtml(item.name)}</div>
                <div class="history-score">
                    <span style="font-weight: 600;">${escapeHtml(item.score)}/10</span>
                    <span class="history-status status-${getStatusClass(item.score, item.status)}">${escapeHtml(cleanStatus(item.status, item.score))}</span>
                </div>
                <div style="margin-top: 1rem; font-size: 0.9rem; color: #64748b;">
                    ${item.timestamp?.seconds ? new Date(item.timestamp.seconds * 1000).toLocaleDateString() : 'Recently'}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('History load error:', error);
    }
}

function showLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
}

function showError(message) {
    const modal = document.getElementById('error-modal');
    document.getElementById('error-message').textContent = message;
    modal.classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('error-modal').classList.add('hidden');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
