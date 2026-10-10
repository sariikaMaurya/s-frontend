/* ===== Visitor Live Chat Widget ==========================================
   Connects to /ws/chat and renders a floating chat panel.
   ======================================================================= */
(function () {
  'use strict';
  let dispose = null;
  let checking = false;
  const defaultSettings = { profile: { name: 'Sarika Maurya' }, chat: { welcomeMessage: "Hi! Send a message and I'll reply as soon as I can." } };
  const storage = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* Chat also works without browser storage. */ } }
  };
  async function syncSettings() {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch('/api/portfolio-settings', { cache: 'no-store' });
      if (!response.ok) throw new Error('Chat settings unavailable');
      const settings = await response.json();
      if (!document.getElementById('chat-bubble')) {
        dispose?.(); dispose = null;
      }
      if (!dispose) dispose = mountChat(settings);
      const title = document.querySelector('.chat-header-info strong');
      const welcome = document.querySelector('.chat-system-msg');
      if (title) title.textContent = `Chat with ${settings.profile.name}`;
      if (welcome) welcome.textContent = settings.chat.welcomeMessage;
    } catch {
      if (!dispose) dispose = mountChat(defaultSettings);
    }
    finally { checking = false; }
  }
  function mountChat(chatSettings) {
  let stopped = false;

  // ── State ───────────────────────────────────────────────────────────────
  let ws = null;
  let sessionId = storage.get('chat_sid') || null;
  let visitorName = storage.get('chat_name') || '';
  let unread = 0;
  let reconnectTimer = null;
  let typingTimer = null;
  let adminTypingTimer = null;

  // ── DOM ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    // Bubble
    const bubble = document.createElement('button');
    bubble.id = 'chat-bubble';
    bubble.setAttribute('aria-label', 'Open live chat');
    bubble.setAttribute('aria-expanded', 'false');
    bubble.innerHTML = `
      <span class="chat-bubble-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z"/><path d="M7 11h10M7 15h6"/></svg></span>
      <span class="chat-close-icon" aria-hidden="true">&#215;</span>
      <span class="chat-badge" id="chat-badge"></span>`;
    document.body.appendChild(bubble);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Live chat');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-avatar"><i class="fas fa-headset"></i></div>
        <div class="chat-header-info">
          <strong>Chat with Shalu</strong>
          <span>Typically replies in minutes</span>
        </div>
        <span class="chat-status-dot" id="chat-status-dot" title="Connecting…"></span>
      </div>
      <div class="chat-messages" id="chat-messages">
        <p class="chat-system-msg">👋 Hi! Send a message and I'll reply as soon as I can.</p>
      </div>
      <div class="chat-typing" id="chat-typing">
        <span></span><span></span><span></span>
      </div>
      <div class="chat-offline-notice" id="chat-offline">Reconnecting…</div>
      ${!visitorName ? `
      <div class="chat-name-row" id="chat-name-row">
        <input id="chat-name-input" type="text" maxlength="60"
               placeholder="Your name (optional)" autocomplete="name" />
      </div>` : ''}
      <div class="chat-input-row">
        <textarea id="chat-textarea" rows="1" maxlength="2000"
                  placeholder="Type a message…" aria-label="Message"></textarea>
        <button class="chat-send-btn" id="chat-send" aria-label="Send message">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>`;
    panel.querySelector('.chat-header-info strong').textContent = `Chat with ${chatSettings.profile.name}`;
    panel.querySelector('.chat-system-msg').textContent = chatSettings.chat.welcomeMessage;
    document.body.appendChild(panel);
    return { bubble, panel };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function fmtTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendMsg(text, fromAdmin, ts) {
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${fromAdmin ? 'from-admin' : 'from-visitor'}`;
    div.innerHTML = `${escHtml(text)}<span class="chat-msg-time">${fmtTime(ts)}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(online) {
    const dot = document.getElementById('chat-status-dot');
    if (!dot) return;
    dot.style.background = online ? '#7fffd4' : '#f87';
    dot.title = online ? 'Connected' : 'Reconnecting…';
    const notice = document.getElementById('chat-offline');
    if (notice) notice.classList.toggle('visible', !online);
  }

  function setBadge(n) {
    unread = n;
    const badge = document.getElementById('chat-badge');
    if (!badge) return;
    badge.textContent = n > 0 ? (n > 9 ? '9+' : n) : '';
    badge.dataset.count = n;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/chat${sessionId ? `?sid=${sessionId}` : ''}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus(true);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'welcome') {
        if (typeof msg.welcomeMessage === 'string') document.querySelector('.chat-system-msg').textContent = msg.welcomeMessage;
        sessionId = msg.sessionId;
        storage.set('chat_sid', sessionId);
      } else if (msg.type === 'admin_msg') {
        clearTimeout(adminTypingTimer);
        document.getElementById('chat-typing')?.classList.remove('visible');
        appendMsg(msg.text, true, msg.ts);
        // If panel is closed, increment badge
        const panel = document.getElementById('chat-panel');
        if (panel?.hidden) setBadge(unread + 1);
      } else if (msg.type === 'admin_typing') {
        const typing = document.getElementById('chat-typing');
        if (typing) {
          typing.classList.add('visible');
          clearTimeout(adminTypingTimer);
          adminTypingTimer = setTimeout(() => typing.classList.remove('visible'), 3000);
          document.getElementById('chat-messages').scrollTop = 99999;
        }
      }
    };

    ws.onclose = event => {
      if (stopped) return;
      setStatus(false);
      reconnectTimer = setTimeout(connect, 4000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function sendMsg(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    ws.send(JSON.stringify({
      type: 'visitor_msg',
      sessionId,
      name: visitorName || 'Visitor',
      text: text.trim()
    }));
    appendMsg(text.trim(), false, null);
  }

  function sendTyping() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'visitor_typing', sessionId }));
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  const { bubble, panel } = buildPanel();

  // Toggle panel
  bubble.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    bubble.setAttribute('aria-expanded', open);
    if (open) {
      setBadge(0);
      document.getElementById('chat-textarea')?.focus();
    }
  });

  // Close on Escape
  function closeOnEscape(e) {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      bubble.setAttribute('aria-expanded', 'false');
    }
  }
  document.addEventListener('keydown', closeOnEscape);

  // Name input
  const nameInput = document.getElementById('chat-name-input');
  if (nameInput) {
    nameInput.addEventListener('change', () => {
      visitorName = nameInput.value.trim();
      storage.set('chat_name', visitorName);
    });
  }

  // Textarea auto-grow
  const textarea = document.getElementById('chat-textarea');
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 90) + 'px';
    // Send typing event (debounced)
    clearTimeout(typingTimer);
    typingTimer = setTimeout(sendTyping, 600);
  });

  // Send on Enter (Shift+Enter = newline)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  function doSend() {
    const text = textarea.value;
    if (!text.trim()) return;
    // Capture name if provided in name row
    const ni = document.getElementById('chat-name-input');
    if (ni && ni.value.trim()) {
      visitorName = ni.value.trim();
      storage.set('chat_name', visitorName);
      // Hide name row after first message
      const nameRow = document.getElementById('chat-name-row');
      if (nameRow) nameRow.style.display = 'none';
    }
    sendMsg(text);
    textarea.value = '';
    textarea.style.height = 'auto';
  }

  document.getElementById('chat-send').addEventListener('click', doSend);

  // Connect WebSocket
  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(typingTimer);
    clearTimeout(adminTypingTimer);
    document.removeEventListener('keydown', closeOnEscape);
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); }
    bubble.remove(); panel.remove();
  };
  }
  dispose = mountChat(defaultSettings);
  syncSettings();
  setInterval(syncSettings, 5000);
  window.addEventListener('focus', syncSettings);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSettings(); });
})();
