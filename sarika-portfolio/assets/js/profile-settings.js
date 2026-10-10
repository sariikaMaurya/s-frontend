(() => {
    fetch('/api/portfolio-settings', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Settings unavailable');
        return response.json();
    }).then(({ profile }) => {
        const names = profile.name.trim().split(/\s+/);
        const firstName = names.shift(); const surname = names.join(' ');
        const brand = document.querySelector('.brand-name');
        if (brand) {
            const second = document.createElement('span'); second.className = 'brand-surname'; second.textContent = surname.toUpperCase();
            brand.replaceChildren(document.createTextNode(firstName), second);
            brand.closest('a').setAttribute('aria-label', `${profile.name} — Home`);
        }
        const hero = document.querySelector('.home .content h2');
        if (hero) {
            const br = document.createElement('br'); const span = document.createElement('span'); span.textContent = `${surname || firstName}.`;
            hero.replaceChildren(document.createTextNode("Hi, I'm"), br, document.createTextNode(surname ? `${firstName} ` : ''), span);
        }
        const about = document.querySelector('.about .content h3'); if (about) about.textContent = `I'm ${profile.name}`;
        const footerName = document.querySelector('.footer .box h3'); if (footerName) footerName.textContent = `${profile.name}'s Portfolio`;
        const credit = document.querySelector('.footer .credit a[href="#home"]'); if (credit) credit.textContent = profile.name;
        for (const image of document.querySelectorAll('.about .image img')) image.alt = profile.name;
        document.title = document.title.replace('Sarika Maurya', profile.name);
        for (const link of document.querySelectorAll('a[href^="mailto:"]')) {
            link.href = `mailto:${profile.email}`;
            if (!link.querySelector('i') && !link.classList.contains('fa-envelope')) link.textContent = profile.email;
        }
        for (const [key, label] of [['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['hackerrank', 'HackerRank'], ['leetcode', 'LeetCode']]) {
            for (const link of document.querySelectorAll(`a[aria-label="${label}"]`)) {
                const url = profile[key]; link.hidden = !url; link.style.display = url ? '' : 'none';
                if (link.parentElement.tagName === 'LI') link.parentElement.hidden = !url;
                if (url) link.href = url; else link.removeAttribute('href');
            }
        }
    }).catch(() => { /* Keep the existing portfolio if settings are unavailable. */ });
})();
