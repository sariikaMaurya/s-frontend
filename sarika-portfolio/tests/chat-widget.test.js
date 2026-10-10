const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('visitor widget stays enabled even with legacy disabled settings', async () => {
    const ids = new Map(); const selectors = new Map(); const handlers = new Map();
    class Node {
        constructor() { this.style = {}; this.children = []; this.classList = { add() {}, remove() {}, toggle() {} }; }
        setAttribute() {}
        addEventListener() {}
        querySelector(key) { if (!selectors.has(key)) selectors.set(key, new Node()); return selectors.get(key); }
        set innerHTML(html) {
            for (const match of html.matchAll(/id="([^"]+)"/g)) { const node = new Node(); node.id = match[1]; this.children.push(node); ids.set(node.id, node); }
        }
        appendChild(node) { this.children.push(node); if (node.id) ids.set(node.id, node); }
        remove() { if (this.id) ids.delete(this.id); for (const child of this.children) child.remove(); }
    }
    let enabled = false; let poll; let fail = false; let ok = false;
    const sockets = [];
    class Socket {
        constructor() { sockets.push(this); }
        close() { this.closed = true; }
    }
    const document = { body: new Node(), createElement: () => new Node(), getElementById: id => ids.get(id) || null,
        querySelector: key => ids.has('chat-panel') ? selectors.get(key) || null : null,
        addEventListener(key, fn) { handlers.set(key, fn); }, removeEventListener(key) { handlers.delete(key); } };
    const context = { document, window: { addEventListener() {} }, location: { protocol: 'http:', host: 'localhost' },
        sessionStorage: { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); } }, WebSocket: Socket,
        fetch: async () => { if (fail) throw new Error('offline'); return { ok, json: async () => ({ profile: { name: 'Test Name' }, chat: { enabled, welcomeMessage: 'Welcome!' } }) }; },
        setInterval(fn) { poll = fn; }, setTimeout() {}, clearTimeout() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/chat.js'), 'utf8'), context);
    assert.equal(ids.has('chat-bubble'), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ids.has('chat-bubble'), true);
    ok = true; enabled = true; await poll();
    assert.equal(ids.has('chat-bubble'), true); assert.equal(sockets.length, 1);
    await poll(); assert.equal(sockets.length, 1);
    enabled = false; await poll();
    assert.equal(ids.has('chat-bubble'), true); assert.equal(sockets.length, 1);
    enabled = true; await poll();
    assert.equal(ids.has('chat-bubble'), true); assert.equal(sockets.length, 1);
    fail = true; await poll(); assert.equal(ids.has('chat-bubble'), true);
});
