const content = document.querySelector('#dashboard-content');
const loading = document.querySelector('#loading-status');
const error = document.querySelector('#dashboard-error');
const refresh = document.querySelector('#refresh');
const logout = document.querySelector('#logout');
const editor = document.querySelector('#content-editor');
const editorForm = document.querySelector('#content-form');
const editorFields = document.querySelector('#editor-fields');
const editorError = document.querySelector('#editor-error');
const editorSave = document.querySelector('#editor-save');
const saveStatus = document.querySelector('#save-status');
const resumeForm = document.querySelector('#resume-upload-form');
const resumeInput = document.querySelector('#resume-file');
const resumeUploadButton = document.querySelector('#resume-upload-button');
const resumeList = document.querySelector('#resume-list');
const resumeError = document.querySelector('#resume-error');
let editing = null;
let editorBusy = false;
let dashboard = null;
let resumes = [];
let loadingData = false;
const views = {
    settings: ['Account settings', 'Manage your admin password.'],
    overview: ['Overview', "Welcome back. Here's what's happening with your portfolio."],
    messages: ['Messages', 'Conversations sent through your portfolio contact form.'],
    projects: ['Projects', 'Add, edit, or remove the work featured in your portfolio.'],
    skills: ['Skills', 'Keep your portfolio technologies and tools up to date.'],
    experience: ['Experience', 'Manage your roles, internships, and professional journey.'],
    certificates: ['Certificates', 'Showcase your learning, achievements, and professional credentials.'],
    resumes: ['Resumes', 'Upload resumes and choose which one appears on your portfolio.'],
    livechat: ['Live Chat', 'Real-time conversations with visitors on your portfolio.']
};
document.querySelector('#password-change-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.querySelector('#password-change-error');
    const button = form.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(form));
    message.hidden = true;
    if (body.newPassword !== body.confirmPassword) {
        message.textContent = 'New passwords do not match.'; message.hidden = false; return;
    }
    button.disabled = true; button.textContent = 'Saving...';
    try {
        const response = await fetch('/api/admin/change-password', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (response.status === 401) { window.location.replace('/admin'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not change password.');
        form.reset();
        window.location.replace('/admin');
    } catch (failure) {
        message.textContent = failure instanceof TypeError ? 'Could not connect. Please try again.' : failure.message;
        message.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Change password'; }
});
const contentSchemas = {
    projects: { label: 'project', fields: [
        { key: 'name', label: 'Project name', required: true, max: 150 },
        { key: 'desc', label: 'Description', type: 'textarea', required: true, max: 2000 },
        { key: 'category', label: 'Category', options: [['basicweb', 'Basic Web'], ['mern', 'MERN Stack'], ['lamp', 'LAMP Stack'], ['android', 'Android App']] },
        { key: 'image', label: 'Image URL', max: 2048, hint: 'Enter an /assets/ path or a Cloudinary URL such as res.cloudinary.com/<cloud>/image/upload/<asset>.' },
        { key: 'view', label: 'Live project URL', max: 2048, hint: 'Optional. Use https://… or a path starting with /.' },
        { key: 'code', label: 'Source code URL', max: 2048 }
    ] },
    skills: { label: 'skill', fields: [
        { key: 'name', label: 'Skill name', required: true, max: 100 },
        { key: 'icon', label: 'Icon URL', max: 2048, hint: 'Optional. Enter an /assets/ path or a Cloudinary URL such as res.cloudinary.com/<cloud>/image/upload/<asset>.' }
    ] },
    experience: { label: 'experience', fields: [
        { key: 'title', label: 'Company or title', required: true, max: 180 },
        { key: 'role', label: 'Role', required: true, max: 180 },
        { key: 'period', label: 'Dates', required: true, max: 120, hint: 'For example: Oct 2023 - Mar 2024, or Jan 2025 - Present.' },
        { key: 'description', label: 'Description', type: 'textarea', max: 3000 }
    ] },
    certificates: { label: 'certificate', fields: [
        { key: 'title', label: 'Certificate title', required: true, max: 180 },
        { key: 'issuer', label: 'Issuing organization', required: true, max: 180 },
        { key: 'issuedOn', label: 'Issue date', type: 'date', half: true },
        { key: 'credentialId', label: 'Credential ID', max: 150, half: true },
        { key: 'image', label: 'Certificate image URL', max: 2048, hint: 'Optional. Enter an /assets/ path or a Cloudinary URL such as res.cloudinary.com/<cloud>/image/upload/<asset>. A certificate illustration appears when no image is provided.' },
        { key: 'url', label: 'Credential link', max: 2048, hint: 'Optional. Link to the certificate or verification page using https:// or a path starting with /.' },
        { key: 'description', label: 'Description', type: 'textarea', max: 2000, hint: 'Optional. Briefly describe what you learned or achieved.' }
    ] }
};
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}
function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function emptyState(container, title, message) {
    const block = element('div', 'empty-state');
    const collection = { 'project-list': 'projects', 'experience-list': 'experience', 'skill-list': 'skills' }[container.id];
    if (collection) {
        block.classList.add('collection-empty');
        const icon = element('span', 'collection-empty-icon');
        const paths = { projects: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8h18M8 21h8m-4-3v3m-4-9-2 2 2 2m8-4 2 2-2 2"/>', experience: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12l9 4 9-4m-9 2v4"/>', skills: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 20"/>' };
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[collection]}</svg>`;
        block.append(icon, element('span', 'collection-empty-eyebrow', 'A fresh start'));
    }
    block.append(element('strong', '', title), element('p', 'muted', message));
    if (collection) {
        const label = contentSchemas[collection].label;
        const button = element('button', 'button button-primary', `+ Add ${label}`);
        button.type = 'button'; button.addEventListener('click', () => openEditor(collection));
        block.append(button);
    }
    container.append(block);
}
function showView() {
    const requested = location.hash.slice(1);
    if (requested === 'main-content') return;
    const view = Object.hasOwn(views, requested) ? requested : 'overview';
    for (const key of Object.keys(views)) document.querySelector(`#view-${key}`).hidden = key !== view;
    for (const link of document.querySelectorAll('[data-view]')) {
        const active = link.dataset.view === view;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    document.querySelector('#page-title').textContent = views[view][0];
    document.querySelector('#breadcrumb').textContent = views[view][0];
    document.querySelector('#page-description').textContent = views[view][1];
    document.title = `${views[view][0]} | Sarika Maurya's Portfolio`;
    // Lazily initialise the live chat WebSocket on first visit
    if (view === 'livechat' && typeof window.initAdminChat === 'function') {
        window.initAdminChat();
        window.initAdminChat = null; // run once
    }
}
function renderRecent() {
    const container = document.querySelector('#recent-messages');
    container.replaceChildren();
    if (!dashboard.contacts.length) return emptyState(container, 'No messages yet', 'New contact submissions will appear here.');
    dashboard.contacts.slice(0, 4).forEach(contact => {
        const row = element('a', 'recent-message'); row.href = '#messages';
        const avatar = element('span', 'message-avatar', String(contact.name || '?').trim().charAt(0).toUpperCase());
        const body = element('div', 'recent-body');
        body.append(element('strong', '', contact.name || 'Visitor'), element('p', 'muted', contact.message || contact.email || 'No message provided'));
        row.append(avatar, body, element('span', 'message-date', formatDate(contact.timestamp)));
        container.append(row);
    });
}
function renderMessages() {
    const container = document.querySelector('#message-list'); container.replaceChildren();
    if (!dashboard) return;
    const query = document.querySelector('#message-search').value.trim().toLowerCase();
    const contacts = dashboard.contacts.filter(contact => [contact.name, contact.email, contact.phone, contact.message].some(value => String(value || '').toLowerCase().includes(query)));
    if (!contacts.length) return emptyState(container, query ? 'No matching messages' : 'Your inbox is quiet', query ? 'Try another name, email, or keyword.' : 'Messages from your contact form will appear here.');
    for (const contact of contacts) {
        const card = element('article', 'contact-card');
        const heading = element('div', 'contact-heading');
        heading.append(element('h3', '', contact.name || 'Visitor'), element('span', 'message-date', formatDate(contact.timestamp)));
        const details = element('div', 'contact-details');
        details.append(element('span', '', contact.email || 'No email provided'));
        if (contact.phone) details.append(element('span', '', contact.phone));
        card.append(heading, details, element('p', 'contact-message', contact.message || 'No message provided.'));
        container.append(card);
    }
}
function safeLink(value) {
    if (typeof value !== 'string' || !value.trim() || value === '#') return null;
    try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
}
function normalizeImageUrl(value) {
    const imageUrl = typeof value === 'string' ? value.trim() : '';
    return /^res\.cloudinary\.com\//i.test(imageUrl) ? `https://${imageUrl}` : imageUrl;
}
function contentRecordId(item) {
    for (const id of [item?.id, item?._id]) {
        if (typeof id === 'string' && id.trim()) return id;
    }
    return '';
}
function normalizeContentRecords(records) {
    return Array.isArray(records) ? records.map(item => ({
        ...item,
        id: contentRecordId(item)
    })) : [];
}
function normalizeDashboardContent(data) {
    for (const collection of ['projects', 'skills', 'experience', 'certificates']) {
        data[collection] = normalizeContentRecords(data[collection]);
    }
    return data;
}
function renderProjects() {
    const container = document.querySelector('#project-list'); container.replaceChildren();
    if (!dashboard.projects.length) return emptyState(container, 'No projects yet', 'Use Add project to feature your first project.');
    for (const project of dashboard.projects) {
        const card = element('article', 'project-card');
        const imageUrl = /^[a-zA-Z0-9_-]+$/.test(project.image || '') ? `/assets/images/projects/${encodeURIComponent(project.image)}.PNG` : safeLink(project.image);
        if (imageUrl) {
            const img = element('img', 'project-image');
            img.src = imageUrl;
            img.alt = project.name || 'Project preview'; img.loading = 'lazy';
            img.addEventListener('error', () => { img.hidden = true; }); card.append(img);
        }
        const body = element('div', 'project-body');
        body.append(element('span', 'category-tag', project.category || 'Project'), element('h2', '', project.name || 'Untitled project'), element('p', 'muted', project.desc || ''));
        const links = element('div', 'project-links');
        for (const [key, label] of [['view', 'Live project ↗'], ['code', 'Source code ↗']]) {
            const url = safeLink(project.links?.[key]); if (!url) continue;
            const link = element('a', 'text-link', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
        }
        body.append(links, itemActions('projects', project)); card.append(body); container.append(card);
    }
}
function renderSkills() {
    const container = document.querySelector('#skill-list'); container.replaceChildren();
    if (!dashboard.skills.length) return emptyState(container, 'No skills yet', 'Use Add skill to list a technology or tool.');
    for (const skill of dashboard.skills) {
        const item = element('div', 'skill-item');
        const heading = element('div', 'skill-heading');
        const symbol = element('span', 'skill-symbol', String(skill.name || '?').slice(0, 2));
        const iconUrl = safeLink(skill.icon);
        if (iconUrl) {
            const icon = element('img', 'skill-icon'); icon.src = iconUrl; icon.alt = ''; icon.loading = 'lazy';
            icon.addEventListener('error', () => icon.replaceWith(element('span', 'skill-symbol', String(skill.name || '?').slice(0, 2))));
            heading.append(icon);
        } else heading.append(symbol);
        heading.append(element('strong', '', skill.name || 'Skill'));
        item.append(heading, itemActions('skills', skill));
        container.append(item);
    }
}
function renderExperience() {
    const container = document.querySelector('#experience-list'); container.replaceChildren();
    if (!dashboard.experience.length) return emptyState(container, 'No experience yet', 'Use Add experience to add a role or internship.');
    for (const experience of dashboard.experience) {
        const card = element('article', 'experience-card');
        card.append(element('span', 'category-tag', experience.period), element('h2', '', experience.title), element('h3', '', experience.role));
        if (experience.description) card.append(element('p', 'experience-description muted', experience.description));
        card.append(itemActions('experience', experience)); container.append(card);
    }
}
function certificateIcon() {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 48 48');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    for (const shape of [
        ['rect', { x: '6', y: '6', width: '36', height: '28', rx: '3' }],
        ['path', { d: 'M14 14h20M14 20h12M14 26h7M28 32l-1 10 6-3 6 3-1-10' }],
        ['circle', { cx: '33', cy: '28', r: '7' }]
    ]) {
        const part = document.createElementNS('http://www.w3.org/2000/svg', shape[0]);
        for (const [key, value] of Object.entries(shape[1])) part.setAttribute(key, value);
        part.setAttribute('stroke', 'currentColor');
        part.setAttribute('stroke-width', '2');
        part.setAttribute('stroke-linecap', 'round');
        part.setAttribute('stroke-linejoin', 'round');
        icon.append(part);
    }
    return icon;
}
function renderCertificates() {
    const container = document.querySelector('#certificate-list'); container.replaceChildren();
    const certificates = dashboard.certificates || [];
    if (!certificates.length) {
        const empty = element('div', 'empty-state certificate-empty');
        const icon = element('span', 'certificate-empty-icon'); icon.append(certificateIcon());
        empty.append(icon, element('h3', '', 'Your next achievement belongs here'), element('p', 'muted', 'Add your first certificate to share your learning and credentials on your portfolio.'));
        const button = element('button', 'button button-primary', '+ Add certificate'); button.type = 'button';
        button.addEventListener('click', () => openEditor('certificates'));
        empty.append(button); container.append(empty); return;
    }
    for (const certificate of certificates) {
        const card = element('article', 'certificate-card');
        const preview = element('div', 'certificate-preview');
        const fallback = element('div', 'certificate-fallback');
        fallback.setAttribute('aria-hidden', 'true');
        fallback.append(certificateIcon(), element('span', '', 'CERTIFICATE'));
        preview.append(fallback);
        const imageUrl = safeLink(certificate.image);
        if (imageUrl) {
            const img = element('img', 'certificate-image');
            img.src = imageUrl; img.alt = `${certificate.title} certificate`; img.loading = 'lazy';
            img.addEventListener('error', () => img.remove());
            preview.append(img);
        }
        const body = element('div', 'certificate-body');
        const issuer = element('div', 'certificate-issuer');
        const mark = element('span', 'certificate-issuer-mark', String(certificate.issuer || '?').trim().charAt(0).toUpperCase()); mark.setAttribute('aria-hidden', 'true');
        issuer.append(mark, element('span', '', certificate.issuer));
        body.append(issuer, element('h2', '', certificate.title));
        if (certificate.issuedOn) {
            const date = element('time', 'certificate-date', `Issued ${formatDate(`${certificate.issuedOn}T12:00:00`)}`);
            date.dateTime = certificate.issuedOn; body.append(date);
        }
        if (certificate.description) body.append(element('p', 'certificate-description muted', certificate.description));
        if (certificate.credentialId) {
            const credential = element('dl', 'certificate-credential');
            credential.append(element('dt', '', 'Credential ID'), element('dd', '', certificate.credentialId)); body.append(credential);
        }
        const url = safeLink(certificate.url);
        if (url) {
            const link = element('a', 'text-link certificate-link', 'View credential \u2197');
            link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', `View ${certificate.title} credential (opens in a new tab)`); body.append(link);
        }
        const footer = element('div', 'certificate-actions'); footer.append(itemActions('certificates', certificate));
        body.append(footer); card.append(preview, body); container.append(card);
    }
}
function renderResumes() {
    resumeList.replaceChildren();
    if (!resumes.length) return emptyState(resumeList, 'No resumes uploaded', 'Upload a PDF resume to make it available from your portfolio.');
    for (const resume of resumes) {
        const row = element('article', 'resume-item');
        const details = element('div', 'resume-item-details');
        details.append(element('strong', '', resume.filename));
        details.append(element('span', '', `${(resume.size / (1024 * 1024)).toFixed(2)} MB · Uploaded ${formatDate(resume.uploadedAt)}`));
        const actions = element('div', 'resume-item-actions');
        if (resume.active) {
            actions.append(element('span', 'resume-active-badge', 'Currently shown'));
        } else {
            const activate = element('button', 'item-button', 'Set as current');
            activate.type = 'button';
            activate.addEventListener('click', () => updateResume(`/api/admin/resumes/${encodeURIComponent(resume.id)}/active`, 'PATCH', 'Resume selection updated.'));
            actions.append(activate);
        }
        const remove = element('button', 'item-button danger-text', 'Delete');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Delete resume ${resume.filename}`);
        remove.addEventListener('click', () => {
            if (window.confirm(`Delete "${resume.filename}"?`)) {
                updateResume(`/api/admin/resumes/${encodeURIComponent(resume.id)}`, 'DELETE', 'Resume deleted.');
            }
        });
        actions.append(remove); row.append(details, actions); resumeList.append(row);
    }
}
async function loadResumes() {
    resumeError.hidden = true;
    const response = await fetch('/api/admin/resumes', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { window.location.replace('/admin'); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load resumes.');
    resumes = result.resumes;
    renderResumes();
}
async function updateResume(url, method, successMessage) {
    resumeError.hidden = true;
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: method === 'PATCH' || method === 'DELETE' ? '{}' : undefined,
            credentials: 'same-origin'
        });
        if (response.status === 401) { window.location.replace('/admin'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not update resumes.');
        resumes = result.resumes;
        renderResumes();
        saveStatus.textContent = successMessage;
        saveStatus.hidden = false;
    } catch (failure) {
        resumeError.textContent = failure instanceof TypeError ? 'Could not connect. Please try again.' : failure.message;
        resumeError.hidden = false;
    }
}
resumeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const files = Array.from(resumeInput.files || []);
    if (!files.length) return;
    const invalidType = files.find(file => !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf'));
    if (invalidType) {
        resumeError.textContent = 'Choose a PDF file.';
        resumeError.hidden = false;
        return;
    }
    if (files.some(file => file.size > 15 * 1024 * 1024)) {
        resumeError.textContent = 'Resume is too large. Maximum size is 15 MB.';
        resumeError.hidden = false;
        return;
    }
    resumeUploadButton.disabled = true;
    resumeInput.disabled = true;
    resumeError.hidden = true;
    resumeUploadButton.textContent = 'Uploading…';
    let uploadedCount = 0;
    let uploadFailure = null;
    try {
        for (const file of files) {
            const response = await fetch(`/api/admin/resumes?filename=${encodeURIComponent(file.name)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/pdf' },
                credentials: 'same-origin',
                body: file
            });
            if (response.status === 401) { window.location.replace('/admin'); return; }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Could not upload ${file.name}.`);
            uploadedCount++;
        }
        saveStatus.textContent = `${uploadedCount} resume${uploadedCount === 1 ? '' : 's'} uploaded.`;
        saveStatus.hidden = false;
    } catch (failure) {
        uploadFailure = failure instanceof TypeError ? 'Could not connect. Please try again.' : failure.message;
    } finally {
        try {
            await loadResumes();
        } catch (failure) {
            uploadFailure = [uploadFailure, failure.message].filter(Boolean).join(' ');
        }
        if (uploadFailure) {
            resumeError.textContent = uploadedCount
                ? `${uploadedCount} resume${uploadedCount === 1 ? '' : 's'} uploaded; ${uploadFailure}`
                : uploadFailure;
            resumeError.hidden = false;
            if (uploadedCount) resumeForm.reset();
        } else {
            resumeForm.reset();
        }
        resumeUploadButton.disabled = false;
        resumeInput.disabled = false;
        resumeUploadButton.textContent = 'Upload resumes';
    }
});
function itemActions(collection, item) {
    const actions = element('div', 'item-actions');
    if (!contentRecordId(item)) {
        actions.append(element('span', 'muted', 'This item has no ID. Refresh the dashboard before editing or deleting it.'));
        return actions;
    }
    for (const [mode, label] of [['edit', 'Edit'], ['delete', 'Delete']]) {
        const button = element('button', `item-button ${mode === 'delete' ? 'danger-text' : ''}`, label);
        button.type = 'button'; button.setAttribute('aria-label', `${label} ${item.name || item.title}`);
        button.addEventListener('click', () => openEditor(collection, item, mode)); actions.append(button);
    }
    return actions;
}
function openEditor(collection, item = null, mode = 'add') {
    if (loadingData || editorBusy) return;
    editing = { collection, item, mode };
    const schema = contentSchemas[collection];
    editor.classList.toggle('certificate-editor', collection === 'certificates');
    editorForm.reset(); editorFields.replaceChildren(); editorError.hidden = true; saveStatus.hidden = true;
    document.querySelector('#editor-title').textContent = `${mode === 'delete' ? 'Delete' : item ? 'Edit' : 'Add'} ${schema.label}`;
    document.querySelector('#editor-description').textContent = mode === 'delete'
        ? `Delete “${item.name || item.title}” from your portfolio? This removes the saved item.`
        : 'Saved changes appear on your portfolio when the page is refreshed.';
    editorSave.textContent = mode === 'delete' ? 'Delete item' : 'Save changes';
    editorSave.classList.toggle('button-danger', mode === 'delete');
    if (mode !== 'delete') {
        for (const field of schema.fields) {
            const wrapper = element('div', `editor-field${field.half ? ' editor-field-half' : ''}`);
            const label = element('label', '', field.label + (field.required ? ' *' : ''));
            label.htmlFor = `field-${field.key}`;
            const input = element(field.options ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
            input.id = label.htmlFor; input.name = field.key; input.required = Boolean(field.required);
            if (input.tagName === 'INPUT') input.type = field.type || 'text';
            if (field.max) input.maxLength = field.max;
            if (field.type === 'textarea') input.rows = 4;
            if (field.options) for (const [value, text] of field.options) { const option = element('option', '', text); option.value = value; input.append(option); }
            input.value = (['view', 'code'].includes(field.key) ? item?.links?.[field.key] : item?.[field.key]) ?? field.options?.[0][0] ?? '';
            wrapper.append(label, input);
            if (field.hint) { const hint = element('p', 'field-hint', field.hint); hint.id = `hint-${field.key}`; input.setAttribute('aria-describedby', hint.id); wrapper.append(hint); }
            editorFields.append(wrapper);
        }
    }
    editor.showModal();
    (mode === 'delete' ? document.querySelector('#editor-cancel') : editorFields.querySelector('input, textarea, select'))?.focus();
}
function closeEditor() { if (!editorBusy) editor.close(); }
document.querySelector('#editor-close').addEventListener('click', closeEditor);
document.querySelector('#editor-cancel').addEventListener('click', closeEditor);
editor.addEventListener('cancel', event => { if (editorBusy) event.preventDefault(); });
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.add)));
editorForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (editorBusy || !editing) return;
    const { collection, item, mode } = editing;
    if (item && !contentRecordId(item)) {
        editorError.textContent = 'This item has no ID. Refresh the dashboard and try again.';
        editorError.hidden = false;
        return;
    }
    let body = Object.fromEntries(new FormData(editorForm));
    for (const key of ['image', 'icon']) {
        if (typeof body[key] === 'string') body[key] = normalizeImageUrl(body[key]);
    }
    if (collection === 'projects' && mode !== 'delete' && body.image) {
        const local = body.image.startsWith('/assets/');
        const legacyName = /^[a-zA-Z0-9_-]+$/.test(body.image);
        const remote = /^https?:\/\//i.test(body.image) && safeLink(body.image) && !/[\s\\<>"']/.test(body.image);
        if (!(local || legacyName || remote)) {
            editorError.textContent = 'Enter an /assets/ path or a full http(s) image URL, such as a Cloudinary delivery URL.';
            editorError.hidden = false;
            editorFields.querySelector('[name="image"]')?.focus();
            return;
        }
    }
    if (collection === 'certificates' && mode !== 'delete') {
        body = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value.trim()]));
        const invalid = contentSchemas.certificates.fields.find(field => field.required && !body[field.key]);
        let issue = invalid ? { key: invalid.key, message: `Enter a ${invalid.label.toLowerCase()}.` } : null;
        for (const key of ['image', 'url']) {
            const value = body[key];
            const local = key === 'image' ? value.startsWith('/assets/') : value.startsWith('/') && !value.startsWith('//');
            if (!issue && value && (!safeLink(value) || !(local || /^https?:\/\//i.test(value)) || value.includes('\\'))) {
                issue = { key, message: key === 'image' ? 'Use an http(s) image URL or a path under /assets/.' : 'Use an http(s) credential URL or a site path starting with /.' };
            }
        }
        if (issue) {
            editorError.textContent = issue.message; editorError.hidden = false;
            editorFields.querySelector(`[name="${issue.key}"]`)?.focus(); return;
        }
    }
    if (collection === 'projects' && mode !== 'delete') {
        body.links = { view: body.view, code: body.code }; delete body.view; delete body.code;
    }
    editorBusy = true; editorError.hidden = true;
    editorForm.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = true; });
    editorSave.textContent = mode === 'delete' ? 'Deleting…' : 'Saving…';
    try {
        const suffix = item ? `/${encodeURIComponent(contentRecordId(item))}` : '';
        const response = await fetch(`/api/admin/content/${collection}${suffix}`, {
            method: mode === 'delete' ? 'DELETE' : item ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body)
        });
        if (response.status === 401) { window.location.replace('/admin'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save your changes.');
        dashboard[collection] = normalizeContentRecords(result.items);
        dashboard.counts[collection] = result.items.length;
        renderContent(); editor.close();
        if (collection === 'certificates') document.querySelector('[data-add="certificates"]').focus();
        saveStatus.textContent = `${contentSchemas[collection].label[0].toUpperCase() + contentSchemas[collection].label.slice(1)} ${mode === 'delete' ? 'deleted' : item ? 'updated' : 'added'}. Your portfolio is up to date.`;
        saveStatus.hidden = false;
        document.querySelector('#last-updated').textContent = 'Changes saved just now.';
    } catch (failure) {
        editorError.textContent = failure instanceof TypeError ? 'Could not connect. Your changes have not been confirmed. Please try again.' : failure.message; editorError.hidden = false;
    } finally {
        editorBusy = false; editorForm.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = false; });
        editorSave.textContent = mode === 'delete' ? 'Delete item' : 'Save changes';
    }
});
function renderContent() {
    document.querySelector('#project-count').textContent = dashboard.counts.projects;
    document.querySelector('#skill-count').textContent = dashboard.counts.skills;
    document.querySelector('#experience-count').textContent = dashboard.counts.experience;
    document.querySelector('#certificate-count').textContent = dashboard.counts.certificates ?? 0;
    document.querySelector('#nav-certificate-count').textContent = dashboard.counts.certificates ?? 0;
    renderProjects(); renderSkills(); renderExperience(); renderCertificates();
}
async function loadDashboard() {
    if (loadingData || editor.open) return;
    loadingData = true; refresh.disabled = true; error.hidden = true;
    try {
        const response = await fetch('/api/admin/dashboard', { cache: 'no-store', credentials: 'same-origin' });
        if (response.status === 401) { content.hidden = true; window.location.replace('/admin'); return; }
        if (!response.ok) throw new Error('Could not load the dashboard. Please try Refresh.');
        dashboard = normalizeDashboardContent(await response.json());
        await loadResumes();
        document.querySelector('#message-count').textContent = dashboard.counts.messages;
        document.querySelector('#nav-message-count').textContent = dashboard.counts.messages;
        document.querySelector('#account-username').textContent = dashboard.username;
        renderRecent(); renderMessages(); renderContent(); content.hidden = false;
        document.querySelector('#last-updated').textContent = `Updated at ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
    } catch (failure) {
        error.textContent = failure instanceof TypeError ? 'Could not connect. Check your connection and try Refresh.' : failure.message; error.hidden = false;
    } finally { loading.hidden = true; loadingData = false; refresh.disabled = false; }
}
logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
        const response = await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Could not sign out. Please try again.');
        content.hidden = true; window.location.replace('/admin');
    } catch (failure) {
        error.textContent = failure instanceof TypeError ? 'Could not connect. Please try signing out again.' : failure.message; error.hidden = false; logout.disabled = false;
    }
});
refresh.addEventListener('click', loadDashboard);
document.querySelector('#message-search').addEventListener('input', renderMessages);
window.addEventListener('hashchange', showView);
window.addEventListener('pageshow', event => { if (event.persisted) { content.hidden = true; loadDashboard(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadDashboard(); });
document.querySelector('#today').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
showView(); loadDashboard();
