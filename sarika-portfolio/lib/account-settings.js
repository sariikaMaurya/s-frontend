const fs = require('node:fs/promises');
const path = require('node:path');
const defaults = {
    profile: { name: 'Sarika Maurya', email: 'sarikamaurya2006@gmail.com', linkedin: 'https://www.linkedin.com/in/sarikamaurya/', github: 'https://github.com/sariikaMaurya', hackerrank: 'https://www.hackerrank.com/profile/sarikamaurya', leetcode: 'https://leetcode.com/u/sarika_maurya22/' },
    chat: { welcomeMessage: "Hi! Send a message and I'll reply as soon as I can." }
};
function validate(section, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid settings.'), { status: 400 });
    const result = {};
    for (const key of Object.keys(defaults[section] || {})) {
        const value = input[key];
        const max = key === 'welcomeMessage' ? 500 : key === 'name' ? 150 : key === 'email' ? 254 : 2048;
        if (typeof value !== 'string' || value.length > max) throw Object.assign(new Error(`Enter a valid ${key}.`), { status: 400 });
        result[key] = value.trim();
        if (['name', 'email', 'welcomeMessage'].includes(key) && !result[key]) throw Object.assign(new Error(`${key} cannot be empty.`), { status: 400 });
        if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result[key])) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
        if (['linkedin', 'github', 'hackerrank', 'leetcode'].includes(key) && result[key]) {
            let url;
            try { url = new URL(result[key]); } catch {}
            if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error(`Use a valid http(s) URL for ${key}.`), { status: 400 });
            result[key] = url.href;
        }
    }
    return result;
}
async function createAccountSettings(dataDir) {
    const file = path.join(dataDir, '.admin', 'settings.json');
    let state = structuredClone(defaults);
    try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { profile: validate('profile', { ...defaults.profile, ...saved.profile }), chat: validate('chat', { ...defaults.chat, ...saved.chat }) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let pending = Promise.resolve();
    const listeners = new Set();
    return {
        read: () => structuredClone(state),
        onChange(callback) { listeners.add(callback); },
        update(section, input) {
            if (!Object.hasOwn(defaults, section)) throw Object.assign(new Error('Unknown settings section.'), { status: 400 });
            const value = validate(section, input);
            const operation = pending.then(async () => {
                const next = { ...state, [section]: value };
                await fs.mkdir(path.dirname(file), { recursive: true });
                await fs.writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
                await fs.rename(`${file}.tmp`, file);
                state = next;
                for (const callback of listeners) callback(structuredClone(state));
                return structuredClone(state);
            });
            pending = operation.catch(() => {});
            return operation;
        }
    };
}
module.exports = { createAccountSettings };
