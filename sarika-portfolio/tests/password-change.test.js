const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAdminAuth } = require('../lib/admin-auth');

test('password changes validate current password, persist and revoke sessions', async t => {
    const root = await fs.realpath(os.tmpdir());
    const dir = await fs.mkdtemp(path.join(root, 'portfolio-password-'));
    t.after(async () => {
        const resolved = await fs.realpath(dir);
        assert.equal(path.dirname(resolved), root);
        assert.ok(path.basename(resolved).startsWith('portfolio-password-'));
        await fs.rm(resolved, { recursive: true, force: true });
    });
    const oldPassword = 'Old-test-password-123';
    const newPassword = 'New-test-password-456';
    const auth = await createAdminAuth({ dataDir: dir, env: { ADMIN_PASSWORD: oldPassword } });
    function response() {
        return { code: 200, status(code) { this.code = code; return this; },
            json(body) { this.body = body; }, cookie(name, token) { this.token = token; },
            clearCookie() { this.cleared = true; }, setHeader() {} };
    }
    const login = response();
    await auth.login({ headers: {}, ip: 'test', body: { username: 'admin', password: oldPassword } }, login);
    const req = { headers: { cookie: `portfolio_admin=${login.token}` }, ip: 'test', body: {} };
    assert.ok(auth.getSession(req));
    const unauthenticated = response();
    auth.requireApi({ headers: {} }, unauthenticated, () => assert.fail('Anonymous access allowed'));
    assert.equal(unauthenticated.code, 401);
    const crossOrigin = response();
    auth.sameOrigin({ get: key => key === 'origin' ? 'https://other.example' : 'localhost', is: () => true }, crossOrigin, () => assert.fail('Cross-origin allowed'));
    assert.equal(crossOrigin.code, 403);
    for (const body of [
        { currentPassword: 'wrong', newPassword, confirmPassword: newPassword },
        { currentPassword: oldPassword, newPassword: 'short', confirmPassword: 'short' },
        { currentPassword: oldPassword, newPassword, confirmPassword: 'mismatch' }
    ]) {
        const res = response(); await auth.changePassword({ ...req, body }, res);
        assert.equal(res.code, 400); assert.ok(auth.getSession(req));
    }
    const changed = response();
    await auth.changePassword({ ...req, body: { currentPassword: oldPassword, newPassword, confirmPassword: newPassword } }, changed);
    assert.equal(changed.code, 200); assert.ok(changed.cleared); assert.equal(auth.getSession(req), null);
    const saved = await fs.readFile(path.join(dir, '.admin', 'credentials.json'), 'utf8');
    assert.ok(!saved.includes(newPassword));
    for (const instance of [auth, await createAdminAuth({ dataDir: dir, env: {} })]) {
        for (const [password, code] of [[oldPassword, 401], [newPassword, 200]]) {
            const res = response();
            await instance.login({ headers: {}, ip: 'test', body: { username: 'admin', password } }, res);
            assert.equal(res.code, code);
        }
    }
});
