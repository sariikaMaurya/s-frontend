const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { once } = require('node:events');
const { createApp } = require('../server');
const { createContentStore } = require('../lib/content-store');
const { publicRecord } = require('../lib/mongo-store');

const login = { username: 'admin', password: 'Test-only-password-123!' };

test('MongoDB content records expose their document ID to admin actions', () => {
    assert.deepEqual(publicRecord({
        _id: 'saved-skill-id',
        _order: 3,
        name: 'Mongo Db',
        icon: 'https://example.com/mongodb.png'
    }), {
        name: 'Mongo Db',
        icon: 'https://example.com/mongodb.png',
        id: 'saved-skill-id'
    });
});

async function fixture(t, env = { ADMIN_PASSWORD: login.password }) {
    const tempRoot = await fs.realpath(os.tmpdir());
    const dataDir = await fs.mkdtemp(path.join(tempRoot, 'portfolio-admin-'));
    t.after(async () => {
        // Delete only this test's verified temporary directory, never project data.
        const target = await fs.realpath(dataDir);
        assert.equal(path.dirname(target), tempRoot);
        assert.ok(path.basename(target).startsWith('portfolio-admin-'));
        await fs.rm(target, { recursive: true, force: true });
    });
    await fs.writeFile(path.join(dataDir, 'contacts.json'), '[]');
    await fs.writeFile(path.join(dataDir, 'projects.json'), JSON.stringify([{ name: 'Fixture project' }]));
    await fs.writeFile(path.join(dataDir, 'skills.json'), JSON.stringify([{ name: 'JavaScript' }, { name: 'CSS' }]));
    const contentStore = await createContentStore(dataDir);
    const resumes = new Map();
    let activeResumeId = null;
    let contactWrites = Promise.resolve();
    const dataStore = {
        ...contentStore,
        async readContacts() {
            return JSON.parse(await fs.readFile(path.join(dataDir, 'contacts.json'), 'utf8'));
        },
        addContact(entry) {
            const write = contactWrites.then(async () => {
                const contacts = await this.readContacts();
                contacts.push(entry);
                await fs.writeFile(path.join(dataDir, 'contacts.json'), JSON.stringify(contacts, null, 2), 'utf8');
            });
            contactWrites = write.catch(() => {});
            return write;
        },
        async listResumes() {
            return [...resumes.values()].map(({ data, ...resume }) => ({ ...resume, active: resume.id === activeResumeId }));
        },
        async uploadResume(filename, data) {
            const resume = { id: randomUUID(), filename, size: data.length, uploadedAt: new Date().toISOString(), data };
            resumes.set(resume.id, resume);
            return { id: resume.id, filename, size: data.length, uploadedAt: resume.uploadedAt, active: false };
        },
        async getResume(id) {
            const resume = resumes.get(id);
            if (!resume) return null;
            const { data, ...details } = resume;
            return { ...details, active: id === activeResumeId };
        },
        openResume(id) {
            const resume = resumes.get(id);
            return resume ? Readable.from([resume.data]) : null;
        },
        async getActiveResume() {
            return activeResumeId ? this.getResume(activeResumeId) : null;
        },
        async setActiveResume(id) {
            if (!resumes.has(id)) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            activeResumeId = id;
            return this.listResumes();
        },
        async deleteResume(id) {
            if (!resumes.has(id)) throw Object.assign(new Error('Resume not found.'), { status: 404 });
            resumes.delete(id);
            if (activeResumeId === id) activeResumeId = null;
            return this.listResumes();
        }
    };
    const app = await createApp({ dataDir, env, dataStore });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options });
    const post = (route, body, headers = {}) => request(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    return { dataDir, app, base, request, post, dataStore };
}

test('anonymous access is gated and private files are never served', async t => {
    const { request } = await fixture(t);
    for (const route of ['/admin', '/admin/', '/admin/login']) {
        const res = await request(route);
        assert.equal(res.status, 200, route);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(await res.text(), /id="login-form"/);
    }
    for (const route of ['/admin/dashboard', '/admin/dashboard/', '/admin/dashboard.html']) {
        const res = await request(route);
        assert.equal(res.status, 302, route);
        assert.equal(res.headers.get('location'), '/admin');
    }
    for (const route of ['/api/admin/dashboard', '/api/admin/session', '/api/admin/resumes', '/api/contacts']) {
        const res = await request(route);
        assert.equal(res.status, 401, route);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'Please sign in to continue.' });
    }
    for (const route of ['/contacts.json', '/server.js', '/package.json', '/lib/admin-auth.js', '/.admin/credentials.json', '/.admin/login-details.txt', '/admin/assets/dashboard.html', '/admin/login.html', '/assets/%2e%2e/contacts.json']) {
        assert.equal((await request(route)).status, 404, route);
    }
    const legacy = await request('/showdata.html');
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/admin/dashboard#messages');
});

test('login, refresh, session rotation, dashboard data and logout work', async t => {
    const { request, post } = await fixture(t);
    assert.equal((await post('/api/admin/login', { ...login, password: 'wrong' })).status, 401);
    const signedIn = await post('/api/admin/login', login);
    assert.equal(signedIn.status, 200);
    assert.equal((await signedIn.json()).redirect, '/admin/dashboard');
    const cookieHeader = signedIn.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    assert.match(cookieHeader, /Path=\//);
    assert.match(cookieHeader, /Max-Age=28800/);
    const cookie = cookieHeader.split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await request('/admin/dashboard', { headers })).status, 200);
    const dashboardPage = await request('/admin/dashboard', { headers });
    assert.equal(dashboardPage.status, 200);
    const dashboardHtml = await dashboardPage.text();
    assert.doesNotMatch(dashboardHtml, /data-view="education"|data-add="education"/);
    const redirected = await request('/admin', { headers });
    assert.equal(redirected.headers.get('location'), '/admin/dashboard');
    const dashboard = await (await request('/api/admin/dashboard', { headers })).json();
    assert.deepEqual(dashboard.counts, { projects: 1, skills: 2, experience: 0, certificates: 0, messages: 0 });
    assert.deepEqual(dashboard.certificates, []);
    assert.deepEqual(dashboard.contacts, []);
    assert.equal((await request('/education.json')).status, 404);
    const homepage = await (await request('/')).text();
    assert.match(homepage, /Bachelor of Technology in Information Technology/);
    assert.match(homepage, /Government Polytechnic Mohammadi, Kheri/);
    assert.equal(dashboard.username, 'admin');
    assert.deepEqual(await (await request('/api/resumes/active')).json(), { url: null });
    assert.equal((await request('/api/admin/session', { headers: { Cookie: 'portfolio_admin=forged' } })).status, 401);
    const rotated = await post('/api/admin/login', login, headers);
    const newCookie = rotated.headers.get('set-cookie').split(';')[0];
    assert.notEqual(newCookie, cookie);
    assert.equal((await request('/api/admin/session', { headers })).status, 401);
    const signedOut = await post('/api/admin/logout', {}, { Cookie: newCookie });
    assert.equal(signedOut.status, 200);
    assert.match(signedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await request('/api/admin/dashboard', { headers: { Cookie: newCookie } })).status, 401);
    assert.equal((await request('/admin/dashboard', { headers: { Cookie: newCookie } })).status, 302);
});

test('mutations reject cross-origin requests, malformed input and brute force', async t => {
    const { request, post } = await fixture(t);
    for (const route of ['/api/admin/login', '/api/admin/logout']) {
        assert.equal((await post(route, login, { Origin: 'https://unrelated.example' })).status, 403);
        assert.equal((await post(route, login, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
        assert.equal((await request(route, { method: 'POST', body: 'username=admin' })).status, 415);
    }
    assert.equal((await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal((await post('/api/admin/login', { username: {}, password: [] })).status, 400);
    assert.equal((await post('/api/admin/login', { username: 'admin', password: 'x'.repeat(20000) })).status, 413);
    for (let count = 0; count < 9; count++) assert.equal((await post('/api/admin/login', { ...login, password: 'wrong' })).status, 401);
    const limited = await post('/api/admin/login', login);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await request('/')).status, 200);
});

test('portfolio pages stay public and contact submissions persist without data loss', async t => {
    const { request, post } = await fixture(t);
    for (const route of ['/', '/index.html', '/projects/', '/experience/', '/skills.json', '/projects.json', '/certificates.json', '/education.json', '/assets/css/style.css', '/admin/assets/admin.css', '/admin/assets/login.js', '/admin/assets/dashboard.js']) {
        assert.equal((await request(route)).status, 200, route);
    }
    assert.equal((await post('/api/save-contact-data', { name: '', email: 'test@example.com' })).status, 400);
    const message = '<img src=x onerror=alert(1)> & "quoted"';
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => post('/api/save-contact-data', {
        name: `Test visitor ${index}`, email: 'test@example.com', phone: '', message
    })));
    responses.forEach(response => assert.equal(response.status, 200));
    const session = await post('/api/admin/login', login);
    const Cookie = session.headers.get('set-cookie').split(';')[0];
    const contacts = await (await request('/api/contacts', { headers: { Cookie } })).json();
    assert.equal(contacts.length, 4);
    assert.equal(new Set(contacts.map(contact => contact.name)).size, 4);
    assert.ok(contacts.every(contact => contact.message === message && contact.timestamp));
});

test('generated credentials persist across restarts while sessions do not', async t => {
    const { dataDir, post, dataStore } = await fixture(t, {});
    const details = await fs.readFile(path.join(dataDir, '.admin', 'login-details.txt'), 'utf8');
    const password = details.match(/^Password: (.+)$/m)[1];
    assert.ok(password.length >= 20);
    const original = await fs.readFile(path.join(dataDir, '.admin', 'credentials.json'), 'utf8');
    assert.ok(!original.includes(password));
    const signedIn = await post('/api/admin/login', { username: 'admin', password });
    assert.equal(signedIn.status, 200);
    const oldCookie = signedIn.headers.get('set-cookie').split(';')[0];
    const restarted = await createApp({ dataDir, env: {}, dataStore });
    assert.equal(await fs.readFile(path.join(dataDir, '.admin', 'credentials.json'), 'utf8'), original);
    const server = restarted.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/api/admin/session`, { headers: { Cookie: oldCookie } })).status, 401);
    assert.equal((await fetch(`${url}/api/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password })
    })).status, 200);
});

test('production session cookies require HTTPS', async t => {
    const { post } = await fixture(t, { ADMIN_PASSWORD: login.password, NODE_ENV: 'production' });
    const response = await post('/api/admin/login', login);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
});

test('admin can upload, select and remove PDF resumes and the public link follows the active choice', async t => {
    const { request, post } = await fixture(t);
    const loginResponse = await post('/api/admin/login', login);
    const Cookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie, 'Content-Type': 'application/pdf' };
    const firstPdf = Buffer.from('%PDF-1.7\nfirst resume');
    const crossOriginUpload = await request('/api/admin/resumes?filename=resume.pdf', {
        method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: firstPdf
    });
    assert.equal(crossOriginUpload.status, 403);
    const invalidType = await request('/api/admin/resumes?filename=resume.pdf', {
        method: 'POST', headers: { Cookie, 'Content-Type': 'text/plain' }, body: firstPdf
    });
    assert.equal(invalidType.status, 415);
    const invalidPdf = await request('/api/admin/resumes?filename=resume.pdf', {
        method: 'POST', headers, body: Buffer.from('not a pdf')
    });
    assert.equal(invalidPdf.status, 400);

    const firstUpload = await request('/api/admin/resumes?filename=first.pdf', {
        method: 'POST', headers, body: firstPdf
    });
    assert.equal(firstUpload.status, 201);
    const first = (await firstUpload.json()).resume;
    assert.equal(first.active, true);
    let publicActive = await (await request('/api/resumes/active')).json();
    assert.equal(publicActive.url, `/resumes/${first.id}`);

    const secondUpload = await request('/api/admin/resumes?filename=second.pdf', {
        method: 'POST', headers, body: Buffer.from('%PDF-1.7\nsecond resume')
    });
    assert.equal(secondUpload.status, 201);
    const second = (await secondUpload.json()).resume;
    const activated = await request(`/api/admin/resumes/${second.id}/active`, {
        method: 'PATCH', headers: { Cookie, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(activated.status, 200);
    assert.equal((await (await request('/api/admin/resumes')).json()).resumes.find(resume => resume.active).id, second.id);
    publicActive = await (await request('/api/resumes/active')).json();
    assert.equal(publicActive.url, `/resumes/${second.id}`);

    const publicPdf = await request(publicActive.url);
    assert.equal(publicPdf.status, 200);
    assert.equal(publicPdf.headers.get('content-type'), 'application/pdf');
    assert.match(publicPdf.headers.get('content-disposition'), /inline/);
    assert.equal(Buffer.from(await publicPdf.arrayBuffer()).toString(), '%PDF-1.7\nsecond resume');

    const removedCurrent = await request(`/api/admin/resumes/${second.id}`, {
        method: 'DELETE', headers: { Cookie, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(removedCurrent.status, 200);
    assert.equal((await (await request('/api/resumes/active')).json()).url, `/resumes/${first.id}`);
    assert.equal((await request(`/api/admin/resumes/${first.id}`, {
        method: 'DELETE', headers: { Cookie, 'Content-Type': 'application/json' }, body: '{}'
    })).status, 200);
    assert.deepEqual(await (await request('/api/resumes/active')).json(), { url: null });
});

test('configuration rejects unusable credentials and explicit reset recovers a damaged file', async t => {
    const { dataDir } = await fixture(t);
    await assert.rejects(createApp({ dataDir, env: { ADMIN_PASSWORD: 'short' } }), /12 to 1024/);
    await assert.rejects(createApp({ dataDir, env: { ADMIN_PASSWORD: 'x'.repeat(1025) } }), /12 to 1024/);
    await assert.rejects(createApp({ dataDir, env: { ADMIN_PASSWORD: login.password, ADMIN_USERNAME: ' ' } }), /1 to 150/);
    const file = path.join(dataDir, '.admin', 'credentials.json');
    await fs.writeFile(file, 'null');
    await assert.rejects(createApp({ dataDir, env: {} }), /Invalid admin credentials/);
    await fs.writeFile(file, '{broken');
    await assert.rejects(createApp({ dataDir, env: {} }), SyntaxError);
    await createApp({ dataDir, env: { ADMIN_USERNAME: ' admin ', ADMIN_PASSWORD: login.password } });
    const credentials = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(credentials.username, 'admin');
    assert.match(credentials.hash, /^[a-f0-9]{128}$/);
});

const contentFixtures = {
    projects: { name: 'New project', desc: 'A test project description.', category: 'basicweb', image: 'portfolio1', links: { view: 'https://example.com/project', code: 'https://example.com/source' } },
    skills: { name: 'Node.js', icon: 'https://example.com/icon.png' },
    experience: { title: 'Example Company', role: 'Developer | Internship', period: 'Jan 2025 - Present', description: 'Built and maintained applications.' },
    certificates: { title: 'Web Development', issuer: 'Example Academy', issuedOn: '2024-02-29', credentialId: 'CERT-123', description: 'Completed a web development course.', image: '/assets/images/certificate.png', url: 'https://example.com/verify/CERT-123' }
};

test('all content sections support add, edit and delete with durable JSON and public data', async t => {
    const { dataDir, request, post, dataStore } = await fixture(t);
    const response = await post('/api/admin/login', login);
    const Cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie, 'Content-Type': 'application/json' };
    for (const [collection, value] of Object.entries(contentFixtures)) {
        const route = `/api/admin/content/${collection}`;
        const original = await (await request(`/${collection}.json`)).json();
        const added = await post(route, value, { Cookie });
        assert.equal(added.status, 201, collection);
        const { item } = await added.json();
        assert.ok(item.id);
        const file = path.join(dataDir, `${collection}.json`);
        const records = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.deepEqual(records[0], item);
        assert.equal(records.length, original.length + 1);
        let publicResponse = await request(`/${collection}.json`);
        assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await publicResponse.json(), records);
        const dashboard = await (await request('/api/admin/dashboard', { headers })).json();
        assert.equal(dashboard.counts[collection], records.length);
        assert.deepEqual(dashboard[collection], records);
        const titleKey = ['experience', 'certificates'].includes(collection) ? 'title' : 'name';
        const edited = { ...value, [titleKey]: 'Updated <b>text</b> & quotes "safe"' };
        const update = await request(`${route}/${item.id}`, { method: 'PUT', headers, body: JSON.stringify(edited) });
        assert.equal(update.status, 200, collection);
        const updatedItem = (await update.json()).item;
        assert.equal(updatedItem.id, item.id);
        assert.equal(updatedItem[titleKey], edited[titleKey]);
        // Re-open the app from disk: saved edits survive application restarts.
        await createApp({ dataDir, env: {}, dataStore });
        publicResponse = await request(`/${collection}.json`);
        assert.deepEqual((await publicResponse.json()).find(entry => entry.id === item.id), updatedItem);
        const deleted = await request(`${route}/${item.id}`, { method: 'DELETE', headers, body: '{}' });
        assert.equal(deleted.status, 200, collection);
        assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), original);
        await createApp({ dataDir, env: {}, dataStore });
        assert.deepEqual(await (await request(`/${collection}.json`)).json(), original);
        const afterDelete = await (await request('/api/admin/dashboard', { headers })).json();
        assert.equal(afterDelete.counts[collection], original.length);
        assert.deepEqual(afterDelete[collection], original);
        assert.equal((await request(`${route}/${item.id}`, { method: 'DELETE', headers, body: '{}' })).status, 404);
    }
});

test('content writes require login, same-origin JSON, valid fields and safe URLs', async t => {
    const { request, post } = await fixture(t);
    assert.equal((await request('/api/admin/upload-image', { method: 'POST', body: 'removed' })).status, 404);
    for (const collection of Object.keys(contentFixtures)) {
        const route = `/api/admin/content/${collection}`;
        assert.equal((await request(route)).status, 401);
        assert.equal((await post(route, contentFixtures[collection])).status, 401);
        for (const method of ['PUT', 'DELETE']) assert.equal((await request(`${route}/missing`, { method })).status, 401);
    }
    const loginResponse = await post('/api/admin/login', login);
    const Cookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie, 'Content-Type': 'application/json' };
    for (const collection of Object.keys(contentFixtures)) {
        assert.equal((await post(`/api/admin/content/${collection}`, contentFixtures[collection], { Cookie, Origin: 'https://unrelated.example' })).status, 403);
        assert.equal((await post(`/api/admin/content/${collection}`, {}, { Cookie })).status, 400);
        for (const method of ['PUT', 'DELETE']) {
            const res = await request(`/api/admin/content/${collection}/missing`, { method, headers: { ...headers, Origin: 'https://unrelated.example' }, body: '{}' });
            assert.equal(res.status, 403);
        }
    }
    for (const badUrl of ['javascript:alert(1)', 'data:image/svg+xml,test', '//unrelated.example/image.png', '/admin/assets/login.js', 'https://example.com/" onerror="alert(1)']) {
        assert.equal((await post('/api/admin/content/skills', { name: 'Bad URL', icon: badUrl }, { Cookie })).status, 400, badUrl);
    }
    assert.equal((await post('/api/admin/content/projects', { ...contentFixtures.projects, category: 'not-a-category' }, { Cookie })).status, 400);
    assert.equal((await post('/api/admin/content/projects', { ...contentFixtures.projects, links: { view: 'javascript:alert(1)' } }, { Cookie })).status, 400);
    assert.equal((await post('/api/admin/content/projects', { ...contentFixtures.projects, image: 'C:\\Users\\test\\image.png' }, { Cookie })).status, 400);
    assert.equal((await post('/api/admin/content/experience', { ...contentFixtures.experience, period: ' ' }, { Cookie })).status, 400);
    assert.equal((await post('/api/admin/content/credentials', {}, { Cookie })).status, 404);
    const allowed = await post('/api/admin/content/projects', { ...contentFixtures.projects, image: '/assets/images/example.jpg', links: { view: '/projects/', code: '' } }, { Cookie });
    assert.equal(allowed.status, 201);
    const cloudinaryImage = await post('/api/admin/content/projects', {
        ...contentFixtures.projects,
        name: 'Cloudinary project',
        image: 'https://res.cloudinary.com/test-cloud/image/upload/v123/example.png'
    }, { Cookie });
    assert.equal(cloudinaryImage.status, 201);
    assert.equal((await cloudinaryImage.json()).item.image, 'https://res.cloudinary.com/test-cloud/image/upload/v123/example.png');
    const cloudinaryPath = await post('/api/admin/content/projects', {
        ...contentFixtures.projects,
        name: 'Cloudinary path project',
        image: 'res.cloudinary.com/test-cloud/image/upload/v123/path-project.png'
    }, { Cookie });
    assert.equal(cloudinaryPath.status, 201);
    assert.equal((await cloudinaryPath.json()).item.image, 'https://res.cloudinary.com/test-cloud/image/upload/v123/path-project.png');
    const cloudinarySkillIcon = await post('/api/admin/content/skills', {
        name: 'Cloudinary Icon',
        icon: 'https://res.cloudinary.com/test-cloud/image/upload/v123/icon.png'
    }, { Cookie });
    assert.equal(cloudinarySkillIcon.status, 201);
    assert.equal((await cloudinarySkillIcon.json()).item.icon, 'https://res.cloudinary.com/test-cloud/image/upload/v123/icon.png');
    const cloudinaryCertificate = await post('/api/admin/content/certificates', {
        ...contentFixtures.certificates,
        image: 'https://res.cloudinary.com/test-cloud/image/upload/v123/certificate.png'
    }, { Cookie });
    assert.equal(cloudinaryCertificate.status, 201);
    assert.equal((await cloudinaryCertificate.json()).item.image, 'https://res.cloudinary.com/test-cloud/image/upload/v123/certificate.png');
});

test('concurrent writes preserve records and stable IDs keep edits on the correct item', async t => {
    const { dataDir, request, post } = await fixture(t);
    const loginResponse = await post('/api/admin/login', login);
    const Cookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie, 'Content-Type': 'application/json' };
    const initial = await (await request('/skills.json')).json();
    assert.ok(initial.every(skill => skill.id));
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => post('/api/admin/content/skills', { name: `Concurrent ${index}`, icon: '' }, { Cookie })));
    for (const result of results) assert.equal(result.status, 201);
    let records = JSON.parse(await fs.readFile(path.join(dataDir, 'skills.json'), 'utf8'));
    assert.equal(records.length, 8);
    assert.equal(new Set(records.map(record => record.id)).size, 8);
    const target = records[2];
    await request(`/api/admin/content/skills/${records[0].id}`, { method: 'DELETE', headers, body: '{}' });
    const changed = await request(`/api/admin/content/skills/${target.id}`, { method: 'PUT', headers, body: JSON.stringify({ name: 'Correct target', icon: '' }) });
    assert.equal(changed.status, 200);
    records = JSON.parse(await fs.readFile(path.join(dataDir, 'skills.json'), 'utf8'));
    assert.equal(records.find(record => record.id === target.id).name, 'Correct target');
    assert.ok(initial.every(record => records.some(saved => saved.id === record.id)));
});

test('certificate validation rejects impossible dates, unsafe URLs and invalid field lengths', async t => {
    const { request, post } = await fixture(t);
    const signedIn = await post('/api/admin/login', login);
    const Cookie = signedIn.headers.get('set-cookie').split(';')[0];
    const route = '/api/admin/content/certificates';
    const valid = contentFixtures.certificates;
    const invalidChanges = [
        { title: ' ' }, { issuer: '' }, { title: 'x'.repeat(181) }, { issuer: 'x'.repeat(181) },
        { credentialId: 'x'.repeat(151) }, { description: 'x'.repeat(2001) }, { issuedOn: 2024 },
        ...['2025-02-29', '2024-02-30', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '0000-01-01', '2024-1-01', '01/01/2024'].map(issuedOn => ({ issuedOn })),
        ...['javascript:alert(1)', 'data:image/svg+xml,test', '//example.com/image.png', '/admin/assets/login.js', 'https://user:password@example.com/image.png'].map(image => ({ image })),
        ...['javascript:alert(1)', 'data:text/html,test', '//example.com/verify', 'https://example.com/"onclick="alert(1)', 'https://user:password@example.com/verify'].map(url => ({ url }))
    ];
    for (const changes of invalidChanges) {
        const response = await post(route, { ...valid, ...changes }, { Cookie });
        assert.equal(response.status, 400, JSON.stringify(changes));
        assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.deepEqual(await (await request('/certificates.json')).json(), []);
    const minimal = await post(route, { title: '  Certificate title  ', issuer: '  Issuing Academy  ' }, { Cookie });
    assert.equal(minimal.status, 201);
    const { item } = await minimal.json();
    assert.deepEqual(item, { id: item.id, title: 'Certificate title', issuer: 'Issuing Academy', issuedOn: '', credentialId: '', description: '', image: '', url: '' });
    const allowed = await post(route, { ...valid, image: 'https://example.com/certificate.jpg', url: '/assets/certificates/course.pdf' }, { Cookie });
    assert.equal(allowed.status, 201);
});
