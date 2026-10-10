/* ===== Admin Live Chat Panel =============================================
   Connects to /ws/admin/chat and renders a full inbox-style chat panel
   inside the admin dashboard's #view-livechat section.
   ======================================================================= */
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  let ws = null;
  let activeSession = null;
  const sessions = new Map(); // sessionId → { name, online, messages[] }
  let reconnectTimer = null;
  let typingTimers = {};   // sessionId → timeout id

  // ── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('chat-session-list');
    if (!list) return;
    if (sessions.size === 0) {
      list.innerHTML = '<p class="chat-admin-empty">No visitors yet</p>';
      return;
    }
    const items = [...sessions.entries()].map(([id, s]) => {
      const last = s.messages[s.messages.length - 1];
      const preview = last ? escHtml(last.text.slice(0, 55)) : 'No messages yet';
      const time = last ? fmtRelative(last.ts) : '';
      const active = id === activeSession ? 'chat-session-item--active' : '';
      const online = s.online ? '<span class="chat-online-dot"></span>' : '';
      return `<button class="chat-session-item ${active}" data-sid="${escHtml(id)}">
        <span class="chat-si-avatar">${escHtml((s.name || 'V').charAt(0).toUpperCase())}</span>
        <span class="chat-si-body">
          <span class="chat-si-name">${online}${escHtml(s.name || 'Visitor')}</span>
          <span class="chat-si-preview">${preview}</span>
        </span>
        <span class="chat-si-time">${time}</span>
      </button>`;
    }).join('');
    list.innerHTML = items;
    list.querySelectorAll('.chat-session-item').forEach(btn => {
      btn.addEventListener('click', () => selectSession(btn.dataset.sid));
    });
  }

  function renderConversation(sessionId) {
    const area = document.getElementById('chat-conv-messages');
    const header = document.getElementById('chat-conv-header-name');
    const input = document.getElementById('chat-admin-input');
    const sendBtn = document.getElementById('chat-admin-send');
    if (!area) return;

    const s = sessions.get(sessionId);
    if (!s) { area.innerHTML = ''; return; }

    if (header) header.textContent = s.name || 'Visitor';

    // Render messages
    const msgs = s.messages.map(m => {
      const cls = m.from === 'admin' ? 'from-admin-self' : 'from-visitor-side';
      return `<div class="chat-admin-msg ${cls}">
        <span class="chat-admin-msg-text">${escHtml(m.text)}</span>
        <span class="chat-admin-msg-time">${fmtTime(m.ts)}</span>
      </div>`;
    }).join('');
    area.innerHTML = msgs || '<p class="chat-admin-no-msgs">No messages yet. Say hello! 👋</p>';
    area.scrollTop = area.scrollHeight;

    if (input) { input.disabled = false; input.focus(); }
    if (sendBtn) sendBtn.disabled = false;
  }

  function selectSession(sid) {
    activeSession = sid;
    // Clear unread mark
    const s = sessions.get(sid);
    if (s) s.unread = 0;
    renderSidebar();
    renderConversation(sid);
    // Hide typing indicator when switching sessions
    showTyping(false);
  }

  function showTyping(visible) {
    const el = document.getElementById('chat-admin-typing');
    if (el) el.hidden = !visible;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function connect() {
    clearTimeout(reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/admin/chat`);

    const statusEl = document.getElementById('chat-ws-status');

    ws.onopen = () => {
      if (statusEl) { statusEl.textContent = 'Connected'; statusEl.className = 'chat-ws-status online'; }
    };

    ws.onclose = () => {
      if (statusEl) { statusEl.textContent = 'Disconnected — reconnecting…'; statusEl.className = 'chat-ws-status offline'; }
      reconnectTimer = setTimeout(connect, 4000);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'history': {
          sessions.clear();
          for (const s of msg.sessions) {
            sessions.set(s.sessionId, {
              name: s.name || 'Visitor',
              online: s.online,
              messages: s.messages || [],
              unread: 0
            });
          }
          renderSidebar();
          // Auto-select most recent if none active
          if (!activeSession && sessions.size > 0) {
            selectSession([...sessions.keys()][sessions.size - 1]);
          }
          break;
        }

        case 'visitor_join': {
          if (!sessions.has(msg.sessionId)) {
            sessions.set(msg.sessionId, { name: msg.name || 'Visitor', online: true, messages: [], unread: 0 });
          } else {
            sessions.get(msg.sessionId).online = true;
          }
          renderSidebar();
          showToast(`${sessions.get(msg.sessionId)?.name || 'A visitor'} joined`);
          break;
        }

        case 'visitor_leave': {
          if (sessions.has(msg.sessionId)) {
            sessions.get(msg.sessionId).online = false;
          }
          renderSidebar();
          break;
        }

        case 'visitor_msg': {
          const s = sessions.get(msg.sessionId);
          if (!s) break;
          s.name = msg.name || s.name;
          s.messages.push({ from: 'visitor', text: msg.text, ts: msg.ts });
          if (msg.sessionId === activeSession) {
            renderConversation(msg.sessionId);
          } else {
            s.unread = (s.unread || 0) + 1;
            showToast(`${s.name}: ${msg.text.slice(0, 50)}`);
          }
          renderSidebar();
          break;
        }

        case 'visitor_typing': {
          if (msg.sessionId === activeSession) {
            clearTimeout(typingTimers[msg.sessionId]);
            showTyping(true);
            typingTimers[msg.sessionId] = setTimeout(() => showTyping(false), 3000);
          }
          break;
        }

        case 'admin_msg': {
          // Echo from another admin tab
          const s = sessions.get(msg.sessionId);
          if (!s) break;
          s.messages.push({ from: 'admin', text: msg.text, ts: msg.ts });
          if (msg.sessionId === activeSession) renderConversation(msg.sessionId);
          renderSidebar();
          break;
        }
      }
    };
  }

  function sendMsg() {
    const input = document.getElementById('chat-admin-input');
    if (!input || !activeSession) return;
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'admin_msg', sessionId: activeSession, text }));
    // Optimistically append to local session
    const s = sessions.get(activeSession);
    if (s) {
      s.messages.push({ from: 'admin', text, ts: new Date().toISOString() });
      renderConversation(activeSession);
      renderSidebar();
    }
    input.value = '';
    input.focus();
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let toast = document.getElementById('chat-admin-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'chat-admin-toast';
      toast.className = 'chat-admin-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 4000);
  }

  // ── Build UI ──────────────────────────────────────────────────────────────
  function buildChatView() {
    const container = document.getElementById('view-livechat');
    if (!container) return;

    container.innerHTML = `
      <div class="chat-admin-layout">
        <!-- Sidebar: session list -->
        <aside class="chat-admin-sidebar">
          <div class="chat-admin-sidebar-header">
            <h2>Live Chat</h2>
            <span id="chat-ws-status" class="chat-ws-status offline">Connecting…</span>
          </div>
          <div id="chat-session-list" class="chat-session-list">
            <p class="chat-admin-empty">Waiting for visitors…</p>
          </div>
        </aside>

        <!-- Main conversation area -->
        <div class="chat-admin-conv">
          <div class="chat-admin-conv-header">
            <span id="chat-conv-header-name" class="chat-conv-name">Select a conversation</span>
          </div>
          <div id="chat-conv-messages" class="chat-conv-messages">
            <p class="chat-admin-no-msgs">Select a visitor conversation on the left.</p>
          </div>
          <div id="chat-admin-typing" class="chat-admin-typing-row" hidden>
            <span class="chat-typing-dot"></span>
            <span class="chat-typing-dot"></span>
            <span class="chat-typing-dot"></span>
            <span>Visitor is typing…</span>
          </div>
          <div class="chat-admin-input-row">
            <textarea id="chat-admin-input" rows="1" maxlength="2000"
              placeholder="Reply to visitor… (Enter to send)" disabled></textarea>
            <button id="chat-admin-send" class="chat-admin-send-btn" disabled>Send</button>
          </div>
        </div>
      </div>`;

    // Wire up input
    const input = document.getElementById('chat-admin-input');
    const sendBtn = document.getElementById('chat-admin-send');

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });

    sendBtn.addEventListener('click', sendMsg);

    connect();
  }

  // ── Entry point: called when dashboard switches to livechat view ──────────
  window.initAdminChat = buildChatView;

  // Also auto-init if the section already exists in DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('view-livechat')) buildChatView();
    });
  } else {
    if (document.getElementById('view-livechat')) buildChatView();
  }
})();
