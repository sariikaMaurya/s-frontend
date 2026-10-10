// All editable portfolio sections read the same JSON records as the admin panel.
(() => {
    function node(tag, className, value) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (value !== undefined) item.textContent = String(value);
        return item;
    }
    function safeUrl(value) {
        if (typeof value !== 'string' || !value || value === '#') return null;
        try {
            const url = new URL(value, location.origin);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
        } catch { return null; }
    }
    function status(container, message) {
        container.replaceChildren(node('p', 'content-status', message));
        container.classList.add('content-empty');
    }
    function renderEmpty(container, collection, customCopy) {
        const copy = {
            projects: ['Something new is taking shape', 'Projects will appear here as ideas turn into real experiences.', 'fas fa-laptop-code'],
            experience: ['The next chapter is ahead', 'New roles, collaborations and milestones will be shared here.', 'fas fa-briefcase'],
            certificates: ['The learning journey continues', 'Certificates will appear here as new milestones are added.', 'fas fa-award'],
            skills: ['A growing toolkit', 'Technologies and tools will appear here as new skills are added.', 'fas fa-code'],
            education: ['Every journey starts with learning', 'Education details and academic milestones will appear here.', 'fas fa-graduation-cap']
        }[collection];
        if (customCopy) copy.splice(0, 2, ...customCopy);
        const card = node('div', 'portfolio-empty-card');
        const icon = node('span', 'portfolio-empty-icon');
        const symbol = node('i', copy[2]); symbol.setAttribute('aria-hidden', 'true'); icon.append(symbol);
        card.append(icon, node('span', 'portfolio-empty-eyebrow', 'More to come'), node('h3', '', copy[0]), node('p', '', copy[1]));
        container.append(card);
        return card;
    }
    function image(src, alt, fallback) {
        const img = node('img'); img.src = src; img.alt = alt; img.loading = 'lazy'; img.draggable = false;
        img.addEventListener('error', () => { if (fallback) img.replaceWith(fallback); else img.remove(); });
        return img;
    }
    function renderSkills(container, records) {
        for (const skill of records) {
            const bar = node('div', 'bar'); const info = node('div', 'info');
            const fallback = node('span', 'skill-fallback', String(skill.name || '?').slice(0, 2));
            const url = safeUrl(skill.icon);
            info.append(url ? image(url, '', fallback) : fallback, node('span', '', skill.name));
            bar.append(info); container.append(bar);
        }
    }
    function renderProjects(container, records) {
        const grid = container.dataset.projectLayout === 'grid';
        for (const project of records) {
            const card = node('div', 'box');
            const basename = typeof project.image === 'string' && /^[a-zA-Z0-9_-]+$/.test(project.image);
            const src = basename ? `/assets/images/projects/${encodeURIComponent(project.image)}.PNG` : safeUrl(project.image);
            if (src) card.append(image(src, project.name || 'Project preview'));
            const content = node('div', 'content'); const tag = node('div', 'tag');
            tag.append(node('h3', '', project.name));
            const description = node('div', 'desc'); description.append(node('p', '', project.desc));
            const links = node('div', 'btns');
            for (const [key, label, icon] of [['view', 'View', 'fas fa-eye'], ['code', 'Code', 'fas fa-code']]) {
                const url = safeUrl(project.links?.[key]); if (!url) continue;
                const link = node('a', 'btn'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                const symbol = node('i', icon); symbol.setAttribute('aria-hidden', 'true');
                link.append(symbol, document.createTextNode(` ${label}`)); links.append(link);
            }
            description.append(links); content.append(tag, description); card.append(content);
            if (grid) {
                const wrapper = node('div', 'grid-item'); wrapper.dataset.category = project.category;
                wrapper.append(card); container.append(wrapper);
            } else container.append(card);
        }
        if (grid) {
            const filterStatus = renderEmpty(container, 'projects', ['New projects are on the way', 'No projects in this category yet. Explore another category to see more work.']);
            filterStatus.hidden = true;
            const applyFilter = button => {
                const category = button.dataset.filter.replace(/^\./, '');
                let shown = 0;
                container.querySelectorAll('.grid-item').forEach(item => {
                    item.hidden = category !== '*' && item.dataset.category !== category;
                    if (!item.hidden) shown++;
                });
                document.querySelectorAll('#filters button').forEach(filter => {
                    filter.classList.toggle('is-checked', filter === button);
                    filter.setAttribute('aria-pressed', String(filter === button));
                });
                filterStatus.hidden = shown > 0;
            };
            document.querySelectorAll('#filters button').forEach(button => button.addEventListener('click', () => applyFilter(button)));
            const selected = document.querySelector('#filters .is-checked'); if (selected) applyFilter(selected);
        }
    }
    function renderExperience(container, records) {
        // Sort year-wise descending — latest end year on top.
        // "Present" / "current" = this year so active roles always float first.
        function extractEndYear(period) {
            if (!period) return 0;
            const lower = period.toLowerCase();
            if (lower.includes('present') || lower.includes('current')) return new Date().getFullYear();
            const years = period.match(/\b(19|20)\d{2}\b/g);
            if (years && years.length) return parseInt(years[years.length - 1], 10);
            return 0;
        }
        const sorted = [...records].sort((a, b) => extractEndYear(b.period) - extractEndYear(a.period));
        sorted.forEach((experience, index) => {
            const row = node('div', `container ${index % 2 === 0 ? 'left' : 'right'}`);
            const content = node('div', 'content'); const tag = node('div', 'tag');
            tag.append(node('h2', '', experience.title));
            const description = node('div', 'desc');
            description.append(node('h3', '', experience.role), node('p', '', experience.period));
            if (experience.description) description.append(node('p', 'experience-description', experience.description));
            content.append(tag, description); row.append(content); container.append(row);
        });
    }
    function renderEducation(container, records) {
        for (const education of records) {
            const card = node('div', 'box');
            const imageUrl = safeUrl(education.image);
            if (imageUrl) {
                const preview = node('div', 'image');
                preview.append(image(imageUrl, `${education.institution || education.title} logo`));
                card.append(preview);
            }
            const content = node('div', 'content');
            content.append(
                node('h3', '', education.title),
                node('p', '', education.institution),
                node('h4', '', education.period)
            );
            if (education.description) content.append(node('p', '', education.description));
            card.append(content);
            container.append(card);
        }
    }
    function certificatePlaceholder() {
        const placeholder = node('div', 'certificate-placeholder');
        const badge = node('img'); badge.src = '/assets/images/certificate-badge.svg'; badge.alt = ''; badge.width = 80; badge.height = 96;
        placeholder.append(badge, node('span', '', 'Certificate'));
        placeholder.setAttribute('aria-hidden', 'true');
        return placeholder;
    }
    function renderCertificates(container, records) {
        if (!records.length) {
            const empty = node('div', 'certificate-empty');
            const badge = node('img'); badge.src = '/assets/images/certificate-badge.svg'; badge.alt = ''; badge.width = 80; badge.height = 96;
            empty.append(badge, node('h3', '', 'The learning journey continues'), node('p', '', 'Certificates will appear here as new milestones are added.'));
            container.append(empty);
            return;
        }
        for (const certificate of records) {
            const card = node('article', 'certificate-card');
            const preview = node('div', 'certificate-preview');
            const imageUrl = safeUrl(certificate.image);
            preview.append(imageUrl ? image(imageUrl, `${certificate.title} certificate`, certificatePlaceholder()) : certificatePlaceholder());
            const body = node('div', 'certificate-body');
            body.append(node('p', 'certificate-issuer', certificate.issuer), node('h3', '', certificate.title));
            if (certificate.issuedOn) {
                const date = new Date(`${certificate.issuedOn}T00:00:00Z`);
                if (!Number.isNaN(date.getTime())) {
                    const issued = node('time', 'certificate-date', `Issued ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)}`);
                    issued.dateTime = certificate.issuedOn; body.append(issued);
                }
            }
            if (certificate.description) body.append(node('p', 'certificate-description', certificate.description));
            if (certificate.credentialId) {
                const credential = node('p', 'certificate-id', 'Credential ID: ');
                credential.append(node('span', '', certificate.credentialId)); body.append(credential);
            }
            const url = safeUrl(certificate.url) || imageUrl;
            if (url) {
                const footer = node('div', 'certificate-footer');
                const link = node('a', 'certificate-link'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                link.setAttribute('aria-label', `View ${certificate.title} certificate (opens in a new tab)`);
                const arrow = node('span', '', '\u2197'); arrow.setAttribute('aria-hidden', 'true');
                link.append(node('span', '', 'View certificate'), arrow); footer.append(link); body.append(footer);
            }
            card.append(preview, body); container.append(card);
        }
    }
    const renderers = { skills: renderSkills, projects: renderProjects, experience: renderExperience, education: renderEducation, certificates: renderCertificates };
    async function load(container) {
        const collection = container.dataset.content;
        container.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(`/${collection}.json`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Unable to load portfolio content.');
            const records = await response.json();
            if (!Array.isArray(records)) throw new Error('Invalid portfolio data.');
            container.replaceChildren(); container.classList.remove('content-empty');
            if (!records.length) { renderEmpty(container, collection); return; }
            renderers[collection](container, records);
            // Register freshly loaded cards without restarting existing reveals.
            window.PortfolioMotion?.refresh(container);
        } catch {
            status(container, `Could not load ${collection}. Please refresh the page.`);
        } finally { container.setAttribute('aria-busy', 'false'); }
    }
    document.querySelectorAll('[data-content]').forEach(load);
    async function loadActiveResume() {
        try {
            const response = await fetch('/api/resumes/active', { cache: 'no-store' });
            if (!response.ok) throw new Error('Unable to load the active resume.');
            const result = await response.json();
            if (typeof result.url === 'string' && result.url.startsWith('/resumes/')) {
                const link = document.querySelector('#resume-link');
                if (link) {
                    link.href = result.url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.removeAttribute('aria-disabled');
                }
            }
        } catch (error) {
            console.error('Could not load the active resume:', error);
        }
    }
    loadActiveResume();
})();
