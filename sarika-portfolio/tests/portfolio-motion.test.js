const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        dispatchEvent(event) {
            for (const listener of listeners.get(event.type) || []) listener(event);
        }
    };
}

function fixture({ reducedMotion = false, intersectionObserver = true, webAnimations = true } = {}) {
    const animations = [];
    class Element {
        constructor(selector, children = []) {
            this.selector = selector;
            this.children = [];
            this.style = {};
            children.forEach(child => this.appendChild(child));
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        matches(selectors) {
            return selectors.split(',').some(selector => selector.trim() === this.selector);
        }
        querySelectorAll(selectors) {
            return this.children.flatMap(child => [
                ...(child.matches(selectors) ? [child] : []), ...child.querySelectorAll(selectors)
            ]);
        }
        animate(keyframes, options) {
            const animation = Object.assign(eventTarget(), {
                target: this,
                keyframes,
                options,
                cancelCount: 0,
                playState: 'running',
                cancel() {
                    this.cancelCount++;
                    this.playState = 'idle';
                    this.oncancel?.({ type: 'cancel' });
                    this.dispatchEvent({ type: 'cancel' });
                },
                finish() {
                    this.playState = 'finished';
                    this.onfinish?.({ type: 'finish' });
                    this.dispatchEvent({ type: 'finish' });
                }
            });
            animations.push(animation);
            return animation;
        }
    }
    if (!webAnimations) delete Element.prototype.animate;
    const card = new Element('.education .box');
    const document = Object.assign(eventTarget(), {
        visibilityState: 'visible',
        hidden: false,
        body: new Element('body', [card]),
        querySelectorAll(selectors) { return this.body.querySelectorAll(selectors); }
    });
    const media = Object.assign(eventTarget(), {
        matches: reducedMotion,
        change(matches) {
            this.matches = matches;
            this.dispatchEvent({ type: 'change', matches });
        }
    });
    const observers = [];
    class IntersectionObserver {
        constructor(callback) {
            this.callback = callback;
            this.targets = new Set();
            this.observeCount = new Map();
            observers.push(this);
        }
        observe(target) {
            this.targets.add(target);
            this.observeCount.set(target, (this.observeCount.get(target) || 0) + 1);
        }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
    }
    const window = Object.assign(eventTarget(), {
        document,
        Element,
        matchMedia: () => media
    });
    if (intersectionObserver) window.IntersectionObserver = IntersectionObserver;
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../assets/js/portfolio-motion.js'), 'utf8'),
        { ...window, window, console },
        { filename: 'portfolio-motion.js' }
    );
    return {
        window, document, card, media, animations, observers, Element,
        notify(target, isIntersecting) {
            for (const observer of observers) {
                // Deliver queued notifications too, even after unobserve, as browsers may do.
                observer.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }], observer);
            }
        }
    };
}

test('entrances wait for intersection and run once across scrolling and repeated refresh', async () => {
    const f = fixture();
    assert.equal(typeof f.window.PortfolioMotion.refresh, 'function');
    assert.ok(f.observers.some(observer => observer.targets.has(f.card)));
    assert.equal(f.card.style.opacity, undefined, 'content stays visible while waiting');
    f.notify(f.card, false);
    assert.equal(f.animations.length, 0);
    f.notify(f.card, true);
    assert.equal(f.animations.length, 1);
    f.window.PortfolioMotion.refresh();
    f.notify(f.card, false);
    f.notify(f.card, true);
    assert.equal(f.animations.length, 1, 'scrolling cannot restart an entrance');
    f.animations[0].finish();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.animations[0].cancelCount, 1, 'completed effect is removed from compositing');
    assert.equal(f.card.style.opacity, undefined);
    assert.equal(f.card.style.transform, undefined);
    assert.equal(f.card.style.translate, undefined);
    f.window.PortfolioMotion.refresh();
    f.notify(f.card, true);
    assert.equal(f.animations.length, 1);
});

test('refresh registers dynamically added certificate cards without duplicate entrances', () => {
    const f = fixture();
    const card = new f.Element('.certificate-card');
    const container = f.document.body.appendChild(new f.Element('.certificate-grid', [card]));
    f.window.PortfolioMotion.refresh(container);
    f.window.PortfolioMotion.refresh(container);
    assert.ok(f.observers.some(observer => observer.targets.has(card)));
    f.notify(card, true);
    f.notify(card, true);
    assert.equal(f.animations.filter(animation => animation.target === card).length, 1);
});

test('hiding the page cancels active entrances without leaving faded or transformed content', () => {
    const f = fixture();
    f.notify(f.card, true);
    f.document.hidden = true;
    f.document.visibilityState = 'hidden';
    f.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(f.animations[0].cancelCount, 1);
    assert.equal(f.card.style.opacity, undefined);
    assert.equal(f.card.style.transform, undefined);
    assert.equal(f.card.style.translate, undefined);
    f.document.hidden = false;
    f.document.visibilityState = 'visible';
    f.document.dispatchEvent({ type: 'visibilitychange' });
    f.notify(f.card, true);
    assert.equal(f.animations.length, 1);
});

test('reduced-motion preference suppresses entrances and cancels active effects on change', () => {
    const reduced = fixture({ reducedMotion: true });
    reduced.window.PortfolioMotion.refresh();
    reduced.notify(reduced.card, true);
    assert.equal(reduced.animations.length, 0);
    assert.equal(reduced.card.style.opacity, undefined);

    const f = fixture();
    f.notify(f.card, true);
    f.media.change(true);
    assert.equal(f.animations[0].cancelCount, 1);
    const certificate = f.document.body.appendChild(new f.Element('.certificate-card'));
    f.window.PortfolioMotion.refresh();
    f.notify(certificate, true);
    assert.equal(f.animations.length, 1);
    assert.equal(certificate.style.opacity, undefined);
});

test('missing animation APIs leave content visible and refresh safe to call', () => {
    for (const capabilities of [
        { intersectionObserver: false },
        { webAnimations: false },
        { intersectionObserver: false, webAnimations: false }
    ]) {
        const f = fixture(capabilities);
        assert.equal(typeof f.window.PortfolioMotion.refresh, 'function');
        assert.doesNotThrow(() => {
            f.window.PortfolioMotion.refresh();
            f.notify(f.card, true);
        });
        assert.equal(f.animations.length, 0);
        assert.equal(f.card.style.opacity, undefined);
        assert.equal(f.card.style.transform, undefined);
        assert.equal(f.card.style.translate, undefined);
    }
});
