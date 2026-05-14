// Chatbot floating action button logic.
// Relies on chatbot_ui.js providing window.__chatbot_ui

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function showChat(open) {
    const section = $('chat-section');
    if (!section) return;
    if (open) {
      section.classList.remove('hidden');
      section.setAttribute('aria-hidden', 'false');
    } else {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
    }
  }

  function boot() {
    const fab = $('chatbot-fab');
    const closeBtn = $('chatbot-close');

    if (!fab) return;

    // Open/close
    fab.addEventListener('click', () => showChat(true));
    closeBtn?.addEventListener('click', () => showChat(false));

    // Close on Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') showChat(false);
    });

    // Attach main handlers once
    if (window.__chatbot_ui?.attachChatHandlers) {
      window.__chatbot_ui.attachChatHandlers();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();

