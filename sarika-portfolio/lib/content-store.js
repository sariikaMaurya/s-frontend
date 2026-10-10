const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const collections = ['projects', 'skills', 'experience', 'certificates'];
const categories = ['basicweb', 'mern', 'lamp', 'android'];
function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}
function text(value, label, max, required = false) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string' || value.length > max) throw invalid(`${label} must be text with at most ${max} characters.`);
    const result = value.trim();
    if (required && !result) throw invalid(`${label} is required.`);
    return result;
}
function publicUrl(value, label, { image = false, basename = false } = {}) {
    let result = text(value, label, 2048);
    if (image && /^res\.cloudinary\.com\//i.test(result)) result = `https://${result}`;
    if (!result || (!image && result === '#')) return result;
    if (basename && /^[a-zA-Z0-9_-]+$/.test(result)) return result;
    if (/\s|[\\<>"']/.test(result)) throw invalid(`${label} must be a valid URL or site path.`);
    if (result.startsWith('/') && !result.startsWith('//')) {
        const url = new URL(result, 'http://portfolio.local');
        if (url.origin !== 'http://portfolio.local' || (image && !url.pathname.startsWith('/assets/'))) {
            throw invalid(`${label} must use an /assets/ path or an http(s) URL.`);
        }
        return result;
    }
    try {
        const url = new URL(result);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return result;
    } catch { /* Return a field-specific error below. */ }
    throw invalid(image
        ? `${label} must be an /assets/ path or a full http(s) image URL.`
        : `${label} must be an http(s) URL or a path starting with /.`);
}
function issueDate(value) {
    const result = text(value, 'Issue date', 10);
    if (!result) return '';
    const parsed = new Date(`${result}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000-') ||
        !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
        throw invalid('Issue date must be a valid date in YYYY-MM-DD format.');
    }
    return result;
}
function validate(collection, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Enter the item details.');
    if (collection === 'projects') {
        const category = text(body.category, 'Category', 30, true);
        if (!categories.includes(category)) throw invalid('Choose a valid project category.');
        if (body.links != null && (typeof body.links !== 'object' || Array.isArray(body.links))) throw invalid('Project links must be an object.');
        return {
            name: text(body.name, 'Project name', 150, true),
            desc: text(body.desc, 'Description', 2000, true),
            image: publicUrl(body.image, 'Project image', { image: true, basename: true }), category,
            links: { view: publicUrl(body.links?.view, 'Live URL'), code: publicUrl(body.links?.code, 'Code URL') }
        };
    }
    if (collection === 'skills') return {
        name: text(body.name, 'Skill name', 100, true),
        icon: publicUrl(body.icon, 'Skill icon', { image: true })
    };
    if (collection === 'certificates') return {
        title: text(body.title, 'Certificate title', 180, true),
        issuer: text(body.issuer, 'Issuer', 180, true),
        issuedOn: issueDate(body.issuedOn),
        credentialId: text(body.credentialId, 'Credential ID', 150),
        description: text(body.description, 'Description', 2000),
        image: publicUrl(body.image, 'Certificate image', { image: true }),
        url: publicUrl(body.url, 'Certificate URL')
    };
    return {
        title: text(body.title, 'Company or title', 180, true),
        role: text(body.role, 'Role', 180, true),
        period: text(body.period, 'Dates', 120, true),
        description: text(body.description, 'Description', 3000)
    };
}

async function createContentStore(dataDir) {
    const queues = new Map();
    function fileFor(collection) {
        if (!collections.includes(collection)) throw invalid('Content section not found.', 404);
        return path.join(dataDir, `${collection}.json`);
    }
    async function read(collection) {
        try {
            const data = JSON.parse(await fs.readFile(fileFor(collection), 'utf8'));
            if (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
                throw new Error(`Invalid ${collection}.json: expected a list of records.`);
            }
            return data;
        } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    async function write(collection, records) {
        const file = fileFor(collection);
        const temporary = `${file}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(records, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, file);
    }
    function enqueue(collection, task) {
        fileFor(collection);
        const pending = (queues.get(collection) || Promise.resolve()).then(task);
        queues.set(collection, pending.catch(() => {}));
        return pending;
    }
    // Stable IDs prevent a delete from changing the identity of other records.
    for (const collection of collections) {
        const records = await read(collection);
        const used = new Set();
        let changed = false;
        for (const item of records) {
            if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || used.has(item.id)) {
                item.id = randomUUID(); changed = true;
            }
            used.add(item.id);
        }
        if (changed) await write(collection, records);
    }
    async function mutate(collection, operation, id, body) {
        fileFor(collection);
        const value = operation === 'delete' ? null : validate(collection, body);
        return enqueue(collection, async () => {
            const records = await read(collection);
            let item;
            if (operation === 'add') {
                item = { id: randomUUID(), ...value }; records.unshift(item);
            } else {
                const index = records.findIndex(record => record.id === id);
                if (index < 0) throw invalid('This item no longer exists. Refresh the dashboard.', 404);
                if (operation === 'delete') records.splice(index, 1);
                else { item = { id, ...value }; records[index] = item; }
            }
            await write(collection, records);
            return { item, items: records };
        });
    }
    return { read, mutate };
}
module.exports = { createContentStore, collections, validateContent: validate };
