const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createApp } = require('../server');
const { attachChat } = require('../lib/chat');
const { createAccountSettings } = require('../lib/account-settings');

test('account settings persist, protect mutations and control active sessions and chat', async t => {
    const root = await fs.realpath(os.tmpdir());
    const dir = await fs.mkdtemp(path.join(root, 'portfolio-settings-'));
    t.after(async () => {
        const target = await fs.realpath(dir);
        assert.equal(path.dirname(target), root);
        assert.ok(path.basename(target).startsWith('portfolio-settings-'));
        await fs.rm(target, { recursive: true, force: true });
    });
    const password = 'Account-test-password-123';
    const app = await createApp({ dataDir: dir, env: { ADMIN_PASSWORD: password }, dataStore: {} });
    const server = http.createServer(app);
    const chat = attachChat(server, app.locals._auth, app.locals._settings);
    const sockets = [];
    t.after(async () => {
        for (const ws of sockets) ws.terminate();
        for (const ws of [...chat.adminWss.clients, ...chat.visitorWss.clients]) ws.terminate();
        chat.adminWss.close(); chat.visitorWss.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (url, body, Cookie = '', method = 'POST', extra = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie, ...extra }, body: body ? JSON.stringify(body) : undefined });
    async function signIn(username = 'admin') {
        const res = await call('/api/admin/login', { username, password });
        assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0];
    }
    async function socket(url, cookie) {
        const ws = new WebSocket(base.replace('http:', 'ws:') + url, cookie ? { headers: { Cookie: cookie } } : {});
        ws.firstMessage = once(ws, 'message');
        sockets.push(ws); await once(ws, 'open'); return ws;
    }
    assert.equal((await call('/api/admin/settings', null, '', 'GET')).status, 401);
    const cookie = await signIn(); const secondCookie = await signIn();
    const state = await (await call('/api/admin/settings', null, cookie, 'GET')).json();
    assert.equal(state.username, 'admin');
    assert.equal((await call('/api/admin/settings/profile', state.profile, cookie, 'PUT', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('/api/admin/settings/profile', { ...state.profile, github: 'javascript:alert(1)' }, cookie, 'PUT')).status, 400);
    const profile = { ...state.profile, name: 'Updated Name', email: 'updated@example.com', github: '' };
    assert.equal((await call('/api/admin/settings/profile', profile, cookie, 'PUT')).status, 200);
    const visitor = await socket('/ws/chat');
    const chatState = { welcomeMessage: 'Welcome to my portfolio!' };
    assert.equal((await call('/api/admin/settings/chat', chatState, cookie, 'PUT')).status, 200);
    assert.equal(visitor.readyState, WebSocket.OPEN);
    const persisted = await createAccountSettings(dir);
    assert.deepEqual(persisted.read(), { profile, chat: chatState });
    const publicState = await (await call('/api/portfolio-settings', null, '', 'GET')).json();
    assert.deepEqual(publicState, persisted.read()); assert.ok(!Object.hasOwn(publicState, 'username'));
    const greeted = await socket('/ws/chat');
    assert.equal(JSON.parse((await greeted.firstMessage)[0]).welcomeMessage, chatState.welcomeMessage);
    assert.equal((await call('/api/admin/change-username', { username: 'new.admin', currentPassword: 'wrong' }, cookie)).status, 400);
    const adminSocket = await socket('/ws/admin/chat', cookie);
    const adminClosed = once(adminSocket, 'close');
    assert.equal((await call('/api/admin/change-username', { username: 'new.admin', currentPassword: password }, cookie)).status, 200);
    assert.equal((await adminClosed)[0], 1008);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, '.admin', 'credentials.json'), 'utf8')).username, 'new.admin');
    assert.equal((await call('/api/admin/session', null, secondCookie, 'GET')).status, 401);
    assert.equal((await call('/api/admin/login', { username: 'admin', password })).status, 401);
    const newCookie = await signIn('new.admin');
    const otherCookie = await signIn('new.admin');
    assert.equal((await call('/api/admin/logout-all', {}, newCookie)).status, 200);
    for (const value of [newCookie, otherCookie]) assert.equal((await call('/api/admin/session', null, value, 'GET')).status, 401);
});
