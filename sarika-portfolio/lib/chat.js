/**
 * Live Chat module — WebSocket-based real-time chat.
 *
 * Architecture:
 *  - Visitors connect to /ws/chat  (role: visitor)
 *  - Admins connect to  /ws/admin/chat  (role: admin, requires session cookie)
 *
 * Message types (JSON, sent over the wire):
 *  visitor → server:
 *    { type: 'visitor_msg',  sessionId, text }
 *    { type: 'visitor_typing', sessionId }
 *
 *  server → admin(s):
 *    { type: 'visitor_msg',   sessionId, visitorName, text, ts }
 *    { type: 'visitor_typing', sessionId }
 *    { type: 'visitor_join',  sessionId, ts }
 *    { type: 'visitor_leave', sessionId }
 *    { type: 'history',       sessions: [...] }
 *
 *  admin → server:
 *    { type: 'admin_msg',    sessionId, text }
 *    { type: 'admin_typing', sessionId }
 *
 *  server → visitor(s):
 *    { type: 'admin_msg',    text, ts }
 *    { type: 'admin_typing' }
 *    { type: 'welcome',      sessionId }
 */

'use strict';

const { WebSocketServer } = require('ws');
const crypto = require('node:crypto');

// In-memory store: sessionId → { name, ws, messages[] }
const sessions = new Map();
// All connected admin websockets
const adminSockets = new Set();

function broadcast(sockets, data) {
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
    }
}

function sendToAdmins(data) {
    broadcast(adminSockets, data);
}

function sendToVisitor(sessionId, data) {
    const session = sessions.get(sessionId);
    if (session?.ws?.readyState === session?.ws?.OPEN) {
        session.ws.send(JSON.stringify(data));
    }
}

function getHistory() {
    const result = [];
    for (const [id, s] of sessions) {
        result.push({ sessionId: id, name: s.name, messages: s.messages, online: s.ws?.readyState === 1 });
    }
    return result;
}

/**
 * Attach WebSocket chat to an existing http.Server.
 * @param {import('http').Server} server
 * @param {{ getSession: (req) => any }} auth
 */
function attachChat(server, auth, settings) {
    // Visitor WebSocket — no auth required
    const visitorWss = new WebSocketServer({ noServer: true });
    // Admin WebSocket — session required
    const adminWss = new WebSocketServer({ noServer: true });
    auth.onInvalidate?.(() => { for (const ws of adminWss.clients) ws.close(1008, 'Sign in again'); });

    // Route upgrade requests
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/ws/chat') {
            visitorWss.handleUpgrade(req, socket, head, (ws) => {
                visitorWss.emit('connection', ws, req);
            });
        } else if (url.pathname === '/ws/admin/chat') {
            // Validate admin session
            if (!auth.getSession(req)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            adminWss.handleUpgrade(req, socket, head, (ws) => {
                adminWss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    // ── Visitor connections ──────────────────────────────────────────────────
    visitorWss.on('connection', (ws, req) => {
        // Parse or create sessionId from query param
        const url = new URL(req.url, `http://${req.headers.host}`);
        let sessionId = url.searchParams.get('sid');
        if (!sessionId || !sessions.has(sessionId)) {
            sessionId = crypto.randomBytes(10).toString('hex');
        }

        let session = sessions.get(sessionId);
        if (!session) {
            session = { name: `Visitor`, messages: [], ws: null };
            sessions.set(sessionId, session);
        }
        session.ws = ws;

        // Welcome visitor
        ws.send(JSON.stringify({ type: 'welcome', sessionId, welcomeMessage: settings?.read().chat.welcomeMessage }));

        // Notify admins
        sendToAdmins({ type: 'visitor_join', sessionId, name: session.name, ts: new Date().toISOString() });

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }

            if (msg.type === 'visitor_msg') {
                const text = String(msg.text ?? '').trim().slice(0, 2000);
                if (!text) return;
                // Update visitor's display name if provided
                if (msg.name) session.name = String(msg.name).trim().slice(0, 60);
                const entry = { from: 'visitor', text, ts: new Date().toISOString() };
                session.messages.push(entry);
                // Cap history per session
                if (session.messages.length > 200) session.messages.shift();
                sendToAdmins({ type: 'visitor_msg', sessionId, name: session.name, text, ts: entry.ts });
            } else if (msg.type === 'visitor_typing') {
                sendToAdmins({ type: 'visitor_typing', sessionId });
            }
        });

        ws.on('close', () => {
            session.ws = null;
            sendToAdmins({ type: 'visitor_leave', sessionId });
        });
    });

    // ── Admin connections ────────────────────────────────────────────────────
    adminWss.on('connection', (ws, req) => {
        adminSockets.add(ws);

        // Send full history to newly connected admin
        ws.send(JSON.stringify({ type: 'history', sessions: getHistory() }));

        ws.on('message', (raw) => {
            if (!auth.getSession(req)) { ws.close(1008, 'Sign in again'); return; }
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            const { sessionId } = msg;
            if (!sessionId || !sessions.has(sessionId)) return;

            if (msg.type === 'admin_msg') {
                const text = String(msg.text ?? '').trim().slice(0, 2000);
                if (!text) return;
                const entry = { from: 'admin', text, ts: new Date().toISOString() };
                sessions.get(sessionId).messages.push(entry);
                sendToVisitor(sessionId, { type: 'admin_msg', text, ts: entry.ts });
                // Echo to other admins
                broadcast([...adminSockets].filter(s => s !== ws), { type: 'admin_msg', sessionId, text, ts: entry.ts });
            } else if (msg.type === 'admin_typing') {
                sendToVisitor(sessionId, { type: 'admin_typing' });
            }
        });

        ws.on('close', () => {
            adminSockets.delete(ws);
        });
    });

    return { visitorWss, adminWss };
}

module.exports = { attachChat };
