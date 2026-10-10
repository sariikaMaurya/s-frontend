const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const toggle = document.querySelector('#toggle-password');
const submit = document.querySelector('#login-submit');
const error = document.querySelector('#login-error');
document.querySelector('#year').textContent = new Date().getFullYear();
toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    submit.firstElementChild.textContent = 'Signing in…';
    let signedIn = false;
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ username: form.username.value.trim(), password: password.value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to sign in. Please try again.');
        signedIn = true;
        window.location.replace('/admin/dashboard');
    } catch (failure) {
        error.textContent = failure instanceof TypeError ? 'Could not connect. Please try again.' : failure.message;
        error.hidden = false;
    } finally {
        if (!signedIn) { submit.disabled = false; submit.firstElementChild.textContent = 'Sign in'; }
    }
});
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
