(() => {
    const profile = document.querySelector('#profile-settings-form');
    const chat = document.querySelector('#chat-settings-form');
    const username = document.querySelector('#username-settings-form');
    let loaded = false;
    async function request(url, body, method = 'POST') {
        const response = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        if (response.status === 401) { location.replace('/admin'); throw new Error('Please sign in again.'); }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save settings.');
        return result;
    }
    function feedback(node, text, failed = false) {
        node.textContent = text; node.hidden = false; node.classList.toggle('is-error', failed);
    }
    async function load() {
        if (location.hash !== '#settings' || loaded) return;
        try {
            const data = await request('/api/admin/settings', null, 'GET');
            for (const [key, value] of Object.entries(data.profile)) profile.elements.namedItem(key).value = value;
            chat.elements.welcomeMessage.value = data.chat.welcomeMessage;
            username.elements.username.value = data.username;
            loaded = true;
            document.querySelectorAll('#view-settings button[type="submit"]').forEach(button => { button.disabled = false; });
        } catch (error) { feedback(profile.querySelector('.settings-feedback'), 'Could not load settings. Reopen Account settings to retry.', true); }
    }
    document.querySelectorAll('#view-settings button[type="submit"]').forEach(button => { button.disabled = true; });
    for (const [form, url, method, message] of [
        [profile, '/api/admin/settings/profile', 'PUT', 'Profile saved. Your portfolio is up to date.'],
        [chat, '/api/admin/settings/chat', 'PUT', 'Live chat settings saved.'],
        [username, '/api/admin/change-username', 'POST', 'Username updated.']
    ]) {
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const button = form.querySelector('button[type="submit"]');
            const status = form.querySelector('.settings-feedback');
            const body = Object.fromEntries(new FormData(form));
            const label = button.textContent; button.disabled = true; button.textContent = 'Saving...'; status.hidden = true;
            try {
                const result = await request(url, body, method);
                if (result.redirect) { form.reset(); location.replace(result.redirect); return; }
                feedback(status, message);
            } catch (error) { feedback(status, error instanceof TypeError ? 'Could not connect. Please try again.' : error.message, true); }
            finally { button.disabled = false; button.textContent = label; }
        });
    }
    for (const input of document.querySelectorAll('#view-settings input[type="password"]')) {
        const wrapper = document.createElement('div'); wrapper.className = 'settings-password-input';
        input.before(wrapper); wrapper.append(input);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-password-toggle'; button.textContent = 'Show'; button.setAttribute('aria-label', `Show ${input.name === 'currentPassword' ? 'current' : input.name === 'newPassword' ? 'new' : 'confirmation'} password`); button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            const show = input.type === 'password'; input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show'; button.setAttribute('aria-pressed', String(show)); button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} password`);
        });
        input.form.addEventListener('reset', () => { input.type = 'password'; button.textContent = 'Show'; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', 'Show password'); });
        wrapper.append(button);
    }
    document.querySelector('#logout-all-devices').addEventListener('click', async event => {
        const button = event.currentTarget; button.disabled = true;
        try { await request('/api/admin/logout-all', {}); location.replace('/admin'); }
        catch (error) { feedback(document.querySelector('#sessions-feedback'), error.message, true); button.disabled = false; }
    });
    window.addEventListener('hashchange', load); load();
})();
