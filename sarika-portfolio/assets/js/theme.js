(() => {
    const key = 'sarika-portfolio-theme';
    let theme = 'light';
    try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch (_) {}

    const apply = (value) => {
        theme = value === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        document.querySelectorAll('.theme-toggle').forEach((button) => {
            const dark = theme === 'dark';
            const label = `Switch to ${dark ? 'light' : 'dark'} theme`;
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.setAttribute('aria-pressed', String(dark));
            button.querySelector('.theme-toggle-icon').textContent = dark ? '☀' : '☾';
            button.querySelector('.theme-toggle-label').textContent = dark ? 'Light' : 'Dark';
        });
    };
    apply(theme);
    document.addEventListener('DOMContentLoaded', () => {
        apply(theme);
        document.querySelectorAll('.theme-toggle').forEach((button) => {
            button.addEventListener('click', () => {
                apply(theme === 'dark' ? 'light' : 'dark');
                try { localStorage.setItem(key, theme); } catch (_) {}
            });
        });
    });
    window.addEventListener('storage', (event) => {
        if (event.key === key || event.key === null) apply(event.newValue);
    });
})();
