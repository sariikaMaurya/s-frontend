// Progressive enhancement: content is visible even if animation is unavailable.
(() => {
    const selector = [
        '.home .content', '.home .image',
        '.about .row > .image', '.about .row > .content',
        '.skills .bar', '.education .box',
        '.work [data-content="projects"] > .box', '.work .grid-item',
        '.experience .timeline > .container', '.contact .container',
        '.certificate-card', '.certificate-empty'
    ].join(', ');
    const registered = new WeakSet();
    const revealed = new WeakSet();
    const active = new Set();
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let observer;

    function stopAnimations() {
        for (const animation of active) animation.cancel();
        active.clear();
    }

    function reveal(element, delay) {
        if (revealed.has(element)) return;
        revealed.add(element);
        if (preference?.matches || document.hidden) return;
        try {
            // Animate only one level in each section. A small downward offset
            // avoids the old upward overlap; mild fading keeps text readable.
            // Independent translate leaves hover/image transforms untouched.
            const animation = element.animate([
                { opacity: 0.9, translate: '0 16px' },
                { opacity: 1, translate: '0 0' }
            ], {
                duration: 460,
                delay,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'none'
            });
            active.add(animation);
            animation.onfinish = () => {
                active.delete(animation);
                animation.cancel();
            };
            animation.oncancel = () => active.delete(animation);
        } catch { /* Keep the normal, fully visible layout if animation fails. */ }
    }

    if (typeof window.IntersectionObserver === 'function') {
        try {
            observer = new window.IntersectionObserver(entries => {
                let stagger = 0;
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    observer.unobserve(entry.target);
                    reveal(entry.target, Math.min(stagger++ * 40, 120));
                }
            }, { threshold: 0 });
        } catch { /* Unsupported observers leave every section visible. */ }
    }

    function refresh(root = document) {
        if (!observer) return;
        const elements = [...root.querySelectorAll(selector)];
        if (root.matches?.(selector)) elements.unshift(root);
        for (const element of elements) {
            if (registered.has(element) || typeof element.animate !== 'function') continue;
            registered.add(element);
            observer.observe(element);
        }
    }

    window.PortfolioMotion = { refresh };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAnimations();
    });
    preference?.addEventListener?.('change', () => {
        if (preference.matches) stopAnimations();
    });
    // Keyboard focus should immediately expose the control at its final position.
    document.addEventListener('focusin', stopAnimations);
    window.addEventListener('pagehide', stopAnimations);
    refresh();
})();
