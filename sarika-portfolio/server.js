const http = require('node:http');
const express = require('express');
const path = require('node:path');
const { createAdminAuth } = require('./lib/admin-auth');
const { createMongoStore } = require('./lib/mongo-store');
const { attachChat } = require('./lib/chat');
const { createAccountSettings } = require('./lib/account-settings');
const ROOT = __dirname;
const MAX_RESUME_SIZE = 15 * 1024 * 1024;

async function createApp({ dataDir = ROOT, env = process.env, dataStore: suppliedDataStore } = {}) {
    const app = express();
    const auth = await createAdminAuth({ dataDir, env });
    const settings = await createAccountSettings(dataDir);
    app.locals._settings = settings;
    const dataStore = suppliedDataStore || await createMongoStore({ dataDir, env });
    app.disable('x-powered-by');
    app.locals._auth = auth; // exposed so startup block can pass to attachChat
    app.locals._dataStore = dataStore;
    app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
    app.use(express.json({ limit: '16kb' }));
    app.use(['/admin', '/api/admin', '/api/contacts'], (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        next();
    });
    for (const file of ['admin.css', 'login.js', 'dashboard.js', 'chat-admin.js', 'settings.js']) {
        app.get(`/admin/assets/${file}`, (req, res) => res.sendFile(path.join(ROOT, 'admin', file)));
    }
    app.get(['/admin', '/admin/login', '/admin/index.html'], (req, res) => {
        if (auth.getSession(req)) return res.redirect('/admin/dashboard');
        res.sendFile(path.join(ROOT, 'admin', 'login.html'));
    });
    app.get(['/admin/dashboard', '/admin/dashboard.html'], auth.requirePage, (req, res) => {
        res.sendFile(path.join(ROOT, 'admin', 'dashboard.html'));
    });
    app.get('/showdata.html', (req, res) => res.redirect('/admin/dashboard#messages'));
    app.post('/api/admin/login', auth.sameOrigin, auth.login);
    app.post('/api/admin/logout', auth.sameOrigin, auth.logout);
    app.post('/api/admin/change-password', auth.requireApi, auth.sameOrigin, auth.changePassword);
    app.post('/api/admin/change-username', auth.requireApi, auth.sameOrigin, auth.changeUsername);
    app.post('/api/admin/logout-all', auth.requireApi, auth.sameOrigin, auth.logoutAll);
    app.get('/api/admin/settings', auth.requireApi, (req, res) => {
        res.json({ username: req.admin.username, ...settings.read() });
    });
    app.put('/api/admin/settings/:section', auth.requireApi, auth.sameOrigin, async (req, res) => {
        res.json(await settings.update(req.params.section, req.body));
    });
    app.get('/api/portfolio-settings', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(settings.read());
    });
    app.get('/api/admin/session', auth.requireApi, (req, res) => res.json({ username: req.admin.username }));
    app.get('/api/admin/resumes', auth.requireApi, async (req, res) => {
        res.json({ resumes: await dataStore.listResumes() });
    });
    app.post('/api/admin/resumes', auth.requireApi, auth.sameOriginRequest, async (req, res) => {
        if (req.headers['content-type'] !== 'application/pdf') {
            return res.status(415).json({ error: 'Upload a PDF resume.' });
        }
        if (Number(req.headers['content-length']) > MAX_RESUME_SIZE) {
            return res.status(413).json({ error: 'Resume is too large. Maximum size is 15 MB.' });
        }
        const rawName = typeof req.query.filename === 'string' ? req.query.filename : '';
        const filename = rawName.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (!filename || filename.length > 180 || !/\.pdf$/i.test(filename)) {
            return res.status(400).json({ error: 'Choose a PDF file with a valid filename.' });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_RESUME_SIZE) {
                return res.status(413).json({ error: 'Resume is too large. Maximum size is 15 MB.' });
            }
            chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (!data.length || data.subarray(0, 5).toString() !== '%PDF-') {
            return res.status(400).json({ error: 'The selected file is not a valid PDF.' });
        }
        const resume = await dataStore.uploadResume(filename, data);
        if (!(await dataStore.getActiveResume())) await dataStore.setActiveResume(resume.id);
        const savedResume = (await dataStore.listResumes()).find(item => item.id === resume.id);
        res.status(201).json({ resume: savedResume });
    });
    app.patch('/api/admin/resumes/:id/active', auth.requireApi, auth.sameOrigin, async (req, res) => {
        res.json({ resumes: await dataStore.setActiveResume(req.params.id) });
    });
    app.delete('/api/admin/resumes/:id', auth.requireApi, auth.sameOrigin, async (req, res) => {
        let resumes = await dataStore.deleteResume(req.params.id);
        if (resumes.length && !resumes.some(resume => resume.active)) {
            resumes = await dataStore.setActiveResume(resumes[0].id);
        }
        res.json({ resumes });
    });
    app.get('/api/resumes/active', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const resume = await dataStore.getActiveResume();
        res.json({ url: resume ? `/resumes/${encodeURIComponent(resume.id)}` : null });
    });
    app.get('/resumes/:id', async (req, res, next) => {
        const resume = await dataStore.getResume(req.params.id);
        if (!resume) return res.status(404).send('Resume not found.');
        const stream = dataStore.openResume(req.params.id);
        if (!stream) return res.status(404).send('Resume not found.');
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': String(resume.size),
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(resume.filename)}`,
            'Cache-Control': 'public, max-age=300',
            'X-Content-Type-Options': 'nosniff'
        });
        stream.on('error', next);
        stream.pipe(res);
    });
    app.get('/api/admin/dashboard', auth.requireApi, async (req, res) => {
        const [contacts, projects, skills, experience, certificates] = await Promise.all([
            dataStore.readContacts(), dataStore.read('projects'), dataStore.read('skills'), dataStore.read('experience'), dataStore.read('certificates')
        ]);
        res.json({ username: req.admin.username,
            counts: { projects: projects.length, skills: skills.length, experience: experience.length, certificates: certificates.length, messages: contacts.length },
            contacts: contacts.slice().reverse(), projects, skills, experience, certificates });
    });
    app.get('/api/admin/content/:collection', auth.requireApi, async (req, res) => {
        res.json({ items: await dataStore.read(req.params.collection) });
    });
    app.post('/api/admin/content/:collection', auth.requireApi, auth.sameOrigin, async (req, res) => {
        res.status(201).json(await dataStore.mutate(req.params.collection, 'add', null, req.body));
    });
    app.put('/api/admin/content/:collection/:id', auth.requireApi, auth.sameOrigin, async (req, res) => {
        res.json(await dataStore.mutate(req.params.collection, 'edit', req.params.id, req.body));
    });
    app.delete('/api/admin/content/:collection/:id', auth.requireApi, auth.sameOrigin, async (req, res) => {
        res.json(await dataStore.mutate(req.params.collection, 'delete', req.params.id));
    });
    app.get('/api/contacts', auth.requireApi, async (req, res) => res.json(await dataStore.readContacts()));

    app.post('/api/save-contact-data', async (req, res) => {
        const body = req.body;
        if (!body || typeof body.name !== 'string' || typeof body.email !== 'string' || !body.name.trim() || !body.email.trim()) {
            return res.status(400).json({ error: 'Name and email are required.' });
        }
        const limits = { name: 150, email: 254, phone: 60, message: 6000 };
        const entry = {};
        for (const [key, maxLength] of Object.entries(limits)) {
            const value = body[key] ?? '';
            if (typeof value !== 'string' || value.length > maxLength) return res.status(400).json({ error: `Please enter a valid ${key}.` });
            entry[key] = value.trim();
        }
        entry.timestamp = new Date().toISOString();
        await dataStore.addContact(entry);
        res.status(200).json({ message: 'Data saved successfully.' });
    });
    // Only public portfolio content is served; credentials, contacts and source stay private.
    app.use('/assets', express.static(path.join(ROOT, 'assets'), { dotfiles: 'deny' }));
    app.use('/experience', express.static(path.join(ROOT, 'experience'), { dotfiles: 'deny' }));
    app.use('/projects', express.static(path.join(ROOT, 'projects'), { dotfiles: 'deny' }));
    app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
    for (const collection of ['skills', 'projects', 'experience', 'certificates']) {
        app.get(`/${collection}.json`, async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            res.json(await dataStore.read(collection));
        });
    }
    app.get('/404.html', (req, res) => res.sendFile(path.join(ROOT, '404.html')));
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
        res.status(404).sendFile(path.join(ROOT, '404.html'));
    });
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : [400, 404].includes(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.status ? error.message : 'Invalid request.' });
    });
    return app;
}

if (require.main === module) {
    createApp().then(app => {
        const port = Number(process.env.PORT) || 5500;
        const server = http.createServer(app);
        server.on('close', () => {
            app.locals._dataStore.close().catch(error => {
                console.error('MongoDB connection could not close:', error.message);
            });
        });
        // Attach WebSocket-based live chat
        const auth = app.locals._auth;
        attachChat(server, auth, app.locals._settings);
        server.listen(port, () => {
            console.log(`Portfolio: http://localhost:${port}`);
            console.log(`Admin login: http://localhost:${port}/admin`);
            console.log('First-run login details: .admin/login-details.txt');
        });
    }).catch(error => { console.error('Server could not start:', error.message); process.exitCode = 1; });
}
module.exports = { createApp };
