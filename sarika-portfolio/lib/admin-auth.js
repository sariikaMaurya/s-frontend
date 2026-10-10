const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'portfolio_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

async function createAdminAuth({ dataDir, env }) {
    const privateDir = path.join(dataDir, '.admin');
    const credentialFile = path.join(privateDir, 'credentials.json');
    const detailsFile = path.join(privateDir, 'login-details.txt');
    await fs.mkdir(privateDir, { recursive: true });
    let credentials;
    let exists = false;
    try {
        const saved = await fs.readFile(credentialFile, 'utf8');
        exists = true;
        credentials = JSON.parse(saved);
    } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError && env.ADMIN_PASSWORD)) throw error;
    }
    if (env.ADMIN_PASSWORD || !exists) {
        if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD.length > 1024)) {
            throw new Error('ADMIN_PASSWORD must contain 12 to 1024 characters.');
        }
        const password = env.ADMIN_PASSWORD || crypto.randomBytes(15).toString('base64url');
        const username = (env.ADMIN_USERNAME ?? credentials?.username ?? 'admin').trim();
        if (!username || username.length > 150) throw new Error('ADMIN_USERNAME must contain 1 to 150 characters.');
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        credentials = { username, salt, hash };
        const temp = `${credentialFile}.tmp`;
        await fs.writeFile(temp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
        await fs.rename(temp, credentialFile);
        if (!env.ADMIN_PASSWORD) {
            await fs.writeFile(detailsFile, `Portfolio admin login\n\nURL: http://localhost:${Number(env.PORT) || 5500}/admin\nUsername: ${username}\nPassword: ${password}\n\nKeep this file private. It is never served by the website.\n`, { mode: 0o600 });
        } else { await fs.rm(detailsFile, { force: true }); }
    }
    if (!credentials || typeof credentials.username !== 'string' || !credentials.username ||
        !/^[a-f0-9]{32}$/.test(credentials.salt) || !/^[a-f0-9]{128}$/.test(credentials.hash)) {
        throw new Error('Invalid admin credentials file. Set ADMIN_PASSWORD to reset the account.');
    }
    const sessions = new Map();
    const invalidationListeners = new Set();
    let sessionGeneration = 0;
    function invalidateSessions() {
        sessionGeneration++;
        sessions.clear();
        for (const callback of invalidationListeners) callback();
    }
    const attempts = new Map();
    const secureCookie = env.NODE_ENV === 'production';
    const digest = token => crypto.createHash('sha256').update(token).digest('hex');
    function cookieToken(req) {
        const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE_NAME}=`));
        return cookie ? cookie.slice(COOKIE_NAME.length + 1) : '';
    }
    function getSession(req) {
        const key = digest(cookieToken(req));
        const session = sessions.get(key);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) { sessions.delete(key); return null; }
        return session;
    }
    function requireApi(req, res, next) {
        req.admin = getSession(req);
        if (!req.admin) return res.status(401).json({ error: 'Please sign in to continue.' });
        next();
    }
    function requirePage(req, res, next) {
        if (!getSession(req)) return res.redirect('/admin');
        next();
    }
    function isSameOriginRequest(req) {
        const origin = req.get('origin');
        let allowed = true;
        if (origin) {
            try { allowed = new URL(origin).host === req.get('host'); } catch { allowed = false; }
        }
        return allowed && req.get('sec-fetch-site') !== 'cross-site';
    }
    function sameOriginRequest(req, res, next) {
        if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Request not allowed.' });
        next();
    }
    function sameOrigin(req, res, next) {
        if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Request not allowed.' });
        if (!req.is('application/json')) return res.status(415).json({ error: 'A JSON request is required.' });
        next();
    }
    function cookieOptions() { return { httpOnly: true, sameSite: 'strict', secure: secureCookie, path: '/' }; }
    function prune(now) {
        for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
        for (const [ip, attempt] of attempts) if (attempt.expiresAt <= now) attempts.delete(ip);
    }
    async function login(req, res) {
        const generation = sessionGeneration;
        const loginCredentials = credentials;
        const now = Date.now();
        prune(now);
        const ip = req.ip;
        const attempt = attempts.get(ip) || { count: 0, expiresAt: now + ATTEMPT_WINDOW_MS };
        if (attempt.count >= 10) {
            res.setHeader('Retry-After', String(Math.ceil((attempt.expiresAt - now) / 1000)));
            return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
        }
        attempt.count += 1;
        attempts.set(ip, attempt);
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 150 || password.length > 1024) {
            return res.status(400).json({ error: 'Enter your username and password.' });
        }
        const actual = await scrypt(password, loginCredentials.salt, 64);
        const expected = Buffer.from(loginCredentials.hash, 'hex');
        const validPassword = expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
        if (!validPassword || username !== loginCredentials.username || generation !== sessionGeneration || loginCredentials !== credentials) return res.status(401).json({ error: 'Incorrect username or password.' });
        attempts.delete(ip);
        sessions.delete(digest(cookieToken(req)));
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(digest(token), { username: credentials.username, expiresAt: now + SESSION_MS });
        res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_MS });
        res.json({ username: credentials.username, redirect: '/admin/dashboard' });
    }
    function logout(req, res) {
        sessions.delete(digest(cookieToken(req)));
        res.clearCookie(COOKIE_NAME, cookieOptions());
        res.json({ redirect: '/admin' });
    }
    let changingPassword = false;
    async function changePassword(req, res) {
        const { currentPassword, newPassword, confirmPassword } = req.body || {};
        if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024 ||
            typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 1024) {
            return res.status(400).json({ error: 'Enter your current password and a new password of 12 to 1024 characters.' });
        }
        if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
        if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a different new password.' });
        if (changingPassword) return res.status(409).json({ error: 'A password change is in progress. Please try again.' });
        changingPassword = true;
        try {
            const now = Date.now();
            prune(now);
            const key = `password:${req.ip}`;
            const attempt = attempts.get(key) || { count: 0, expiresAt: now + ATTEMPT_WINDOW_MS };
            if (attempt.count >= 10) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
            attempt.count++;
            attempts.set(key, attempt);
            const actual = await scrypt(currentPassword, credentials.salt, 64);
            if (!crypto.timingSafeEqual(actual, Buffer.from(credentials.hash, 'hex'))) {
                return res.status(400).json({ error: 'Current password is incorrect.' });
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const updated = { username: credentials.username, salt, hash: (await scrypt(newPassword, salt, 64)).toString('hex') };
            await fs.rm(detailsFile, { force: true });
            const temp = `${credentialFile}.tmp`;
            await fs.writeFile(temp, JSON.stringify(updated, null, 2), { mode: 0o600 });
            await fs.rename(temp, credentialFile);
            credentials = updated;
            invalidateSessions();
            attempts.delete(key);
            res.clearCookie(COOKIE_NAME, cookieOptions());
            return res.json({ message: 'Password changed. Sign in with your new password.', redirect: '/admin' });
        } finally { changingPassword = false; }
    }
    async function changeUsername(req, res) {
        const { username, currentPassword } = req.body || {};
        if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,50}$/.test(username) || typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024) {
            return res.status(400).json({ error: 'Use 3–50 letters, numbers, dots, underscores or hyphens for your username, and enter your current password.' });
        }
        if (changingPassword) return res.status(409).json({ error: 'An account update is in progress. Please try again.' });
        changingPassword = true;
        try {
            const key = `password:${req.ip}`;
            prune(Date.now());
            const attempt = attempts.get(key) || { count: 0, expiresAt: Date.now() + ATTEMPT_WINDOW_MS };
            if (attempt.count >= 10) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
            attempt.count++; attempts.set(key, attempt);
            const hash = await scrypt(currentPassword, credentials.salt, 64);
            if (!crypto.timingSafeEqual(hash, Buffer.from(credentials.hash, 'hex'))) return res.status(400).json({ error: 'Current password is incorrect.' });
            const updated = { ...credentials, username };
            await fs.rm(detailsFile, { force: true });
            await fs.writeFile(`${credentialFile}.tmp`, JSON.stringify(updated, null, 2), { mode: 0o600 });
            await fs.rename(`${credentialFile}.tmp`, credentialFile);
            credentials = updated;
            attempts.delete(key);
            invalidateSessions();
            res.clearCookie(COOKIE_NAME, cookieOptions());
            res.json({ redirect: '/admin' });
        } finally { changingPassword = false; }
    }
    function logoutAll(req, res) {
        invalidateSessions();
        res.clearCookie(COOKIE_NAME, cookieOptions());
        res.json({ redirect: '/admin' });
    }
    return { login, logout, changePassword, changeUsername, logoutAll, getSession, requireApi, requirePage, sameOrigin, sameOriginRequest,
        onInvalidate(callback) { invalidationListeners.add(callback); } };
}
module.exports = { createAdminAuth };
