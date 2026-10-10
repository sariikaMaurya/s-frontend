(() => {
    const button = document.getElementById('menu');
    const navigation = document.getElementById('not-found-nav');
    if (!button || !navigation) return;

    function setOpen(open) {
        navigation.classList.toggle('nav-toggle', open);
        button.classList.toggle('fa-times', open);
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    }

    button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
    navigation.addEventListener('click', (event) => {
        if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
            setOpen(false);
            button.focus();
        }
    });
    document.addEventListener('click', (event) => {
        if (!navigation.contains(event.target) && !button.contains(event.target)) setOpen(false);
    });
    window.matchMedia('(max-width: 768px)').addEventListener('change', () => setOpen(false));
})();
