// The one keyboard dispatcher. Bindings come from the server (keys.resolve, put on the page by the
// layout as window.hyperKeymap); commands are registered by page scripts in window.hyperCommands:
//   window.hyperCommands['dock.cycleMode'] = { title, run() {}, when() { return true } }
// A key runs the command it is bound to when the command exists and its `when` (if any) is true;
// otherwise the key is left to the browser. Rules:
// - a chord with Ctrl, Alt or Meta fires in text fields too, a bare key (or Shift + key) only outside
//   them; a binding's inInput: true / false overrides that (Escape in the composer, Ctrl-v kept for paste);
//   the later steps of a sequence that began with a modified chord (Ctrl-x b) count as modified;
// - scopes: a binding of a named scope (menu, …) works while window.hyperKeyScopes.<scope>() is true and wins
//   over the global one; the global keys still work under it unless the scope rebinds them;
// - a key somebody already handled (event.defaultPrevented — a widget) is skipped;
// - a sequence ("Ctrl-x b", "g g") waits up to 1.5 s for its next step, Escape or Ctrl-g cancels it.
// Frames forward their keys with postMessage; the receiver calls window.hyperKeys.handle(eventLike).
(() => {
    if (window.hyperKeys) return;
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
    const commands = (window.hyperCommands ??= {});
    const data = window.hyperKeymap || { keymap: 'default', bindings: [] };

    // "Mod-b" → "Meta-b" on a Mac, "Ctrl-b" elsewhere; modifiers in a fixed order.
    const platformChord = chord => {
        const parts = chord.split(/-(?!$)/);
        const key = parts.pop();
        const mods = [...new Set(parts.map(p => p === 'Mod' ? (MAC ? 'Meta' : 'Ctrl') : p))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
        return [...mods, key].join('-');
    };
    // The chord of a keydown, in the same spelling. Shift is part of a printed symbol ("?", "+"), so it
    // only counts for letters and named keys.
    // What Option + letter types on a Mac (U.S. and Dvorak layouts share this layer); dead keys (´ ˆ ˜ ¨ `)
    // arrive as "Dead" and fall back to the layout map / e.code.
    const OPTION = Object.fromEntries(Object.entries({ a: 'å', b: '∫', c: 'ç', d: '∂', f: 'ƒ', g: '©', h: '˙', j: '∆', k: '˚', l: '¬', m: 'µ', o: 'ø', p: 'π', q: 'œ', r: '®', s: 'ß', t: '†', v: '√', w: '∑', x: '≈', y: '¥', z: 'Ω' }).flatMap(([l, c]) => [[c, l], [c.toUpperCase(), l]]));
    let layoutMap = null;
    const loadLayout = () => navigator.keyboard?.getLayoutMap?.().then(m => { layoutMap = m; }).catch(() => {});
    loadLayout();
    window.addEventListener('focus', loadLayout);   // the layout may have been switched in another app
    const eventChord = e => {
        let key = e.key;
        if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
        // Option on a Mac composes a symbol (⌥X gives "≈"): then the letter is the one the active layout puts
        // on that physical key (Dvorak, Colemak, … — navigator.keyboard.getLayoutMap), and only without that
        // map the QWERTY letter of e.code. A letter or digit in e.key is used as it is, whatever the layout.
        // The Option symbol itself names the letter on a Mac whatever the layout (⌥x is ≈ on QWERTY and Dvorak
        // alike), so it is read first; getLayoutMap exists only in Chromium on https/localhost.
        if (e.altKey && !/^[a-z0-9]$/i.test(key)) {
            const letter = OPTION[key] || (/^(Key[A-Z]|Digit\d)$/.test(e.code || '') ? layoutMap?.get(e.code) || e.code.slice(e.code.startsWith('Key') ? 3 : 5) : null);
            if (letter) key = letter;
        }
        const printable = key.length === 1;
        if (printable) key = key.toLowerCase();
        if (key === ' ') key = 'Space';
        const shift = e.shiftKey && (!printable || /[a-z]/.test(key));
        return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', shift && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('-');
    };

    // A trie of sequences per scope: "Ctrl-x b" → tries.global.get("Ctrl-x").next.get("b").binding.
    const tries = {};
    const scopes = (window.hyperKeyScopes ??= {});
    for (const b of data.bindings || []) {
        const steps = String(b.keys).split(' ').map(platformChord);
        let level = (tries[b.scope || 'global'] ??= new Map()), node;
        for (const step of steps) {
            node = level.get(step) || { next: new Map() };
            level.set(step, node);
            level = node.next;
        }
        node.binding = b;
    }

    const editable = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    const runnable = id => { const c = commands[id]; return c && typeof c.run === 'function' && (!c.when || c.when()) ? c : null; };
    let pending = null, pendingModified = false, timer = 0;
    const reset = () => { pending = null; pendingModified = false; clearTimeout(timer); };

    // Returns true when the key was taken (the caller then prevents the default).
    function handle(e) {
        if (e.isComposing || e.defaultPrevented) return false;
        const chord = eventChord(e);
        if (!chord) return false;
        if (pending && (chord === 'Escape' || chord === 'Ctrl-g')) { reset(); return true; }
        // The active named scopes first (in the order they were declared), then global.
        const active = Object.keys(tries).filter(s => s !== 'global' && (() => { try { return !!scopes[s]?.(); } catch { return false; } })());
        const node = pending ? pending.next.get(chord)
            : [...active, 'global'].map(s => tries[s]?.get(chord)).find(n => n && (n.next.size || (n.binding && runnable(n.binding.command))));
        const modified = pendingModified || /(^|-)(Ctrl|Alt|Meta)-/.test(chord);
        const inSequence = !!pending;
        reset();
        if (!node) return inSequence;   // an unknown second step ends the sequence and is swallowed, as in Emacs
        const allowed = b => !editable(e.target) || (b?.inInput ?? modified);
        if (node.next.size) {
            // A prefix is taken in a text field when some sequence under it may finish there: "Ctrl-h b"
            // bound with inInput: false leaves Ctrl-h to the field (delete backward in a Mac text box).
            const leaves = n => [...(n.binding ? [n.binding] : []), ...[...n.next.values()].flatMap(leaves)];
            if (!leaves(node).some(allowed)) return false;
            pending = node;
            pendingModified = modified;
            timer = setTimeout(reset, 1500);
            return true;
        }
        const b = node.binding;
        if (!b || !allowed(b)) return false;
        const command = runnable(b.command);
        if (!command) return false;
        try { command.run(e, ...(b.args || [])); } catch (err) { console.error(`[keys] ${b.command}`, err); }
        return true;
    }

    // Capture, so a scope's keys come before what the focused field would do with them (Ctrl-k in the menu box).
    window.addEventListener('keydown', e => { if (handle(e)) { e.preventDefault(); e.stopPropagation(); } }, true);

    // The keys bound to a command, for titles and hints: "⌘\\" on a Mac, "Ctrl+\\" elsewhere.
    const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Escape: 'Esc', Space: 'Space' };
    const parts = chord => platformChord(chord).split(/-(?!$)/).map(p => MAC
        ? ({ Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[p] ?? NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p))
        : (NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p)));
    const pretty = chord => parts(chord).join(MAC ? '' : '+');
    const bound = (id, scope = 'global') => (data.bindings || []).filter(b => b.command === id && (b.scope || 'global') === scope);
    const label = (id, scope) => bound(id, scope).map(b => String(b.keys).split(' ').map(pretty).join(' ')).join(', ');

    // Hints in the page: [data-keys-for="cmd other"] (+ data-keys-scope) gets the key caps the keymap binds to
    // those commands, [data-keys-chord="Mod-Enter"] one fixed chord; a [data-keys-hint] left without any
    // key cap hides. A run of chords that differ only in a last digit (Mod-1 … Mod-9) is drawn as one "⌘1–9".
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cap = list => `<span class="w-kbd">${list.map(p => `<kbd>${esc(p)}</kbd>`).join('')}</span>`;
    const caps = all => {
        // Mod-j and Ctrl-j are the same chord off a Mac: draw it once.
        const keys = [...new Map(all.map(k => [String(k).split(' ').map(platformChord).join(' '), k])).values()];
        const digits = keys.map(k => /^(.*-)?(\d)$/.exec(k)).filter(Boolean);
        if (keys.length > 2 && digits.length === keys.length && new Set(digits.map(m => m[1])).size === 1) {
            const last = parts(keys.at(-1));
            return cap([...last.slice(0, -1), `${digits[0][2]}–${last.at(-1)}`]);
        }
        return keys.map(k => String(k).split(' ').map(step => cap(parts(step))).join(' ')).join('');
    };
    function paint(root = document) {
        root.querySelectorAll?.('[data-keys-chord]').forEach(el => { el.innerHTML = cap(parts(el.dataset.keysChord)); });
        root.querySelectorAll?.('[data-keys-for]').forEach(el => {
            const scope = el.dataset.keysScope || 'global';
            el.innerHTML = el.dataset.keysFor.split(/\s+/).filter(Boolean).map(id => caps(bound(id, scope).map(b => String(b.keys)))).join('');
        });
        root.querySelectorAll?.('[data-keys-hint]').forEach(el => { el.hidden = !el.querySelector('kbd'); });
    }
    paint();
    document.addEventListener('htmx:after:swap', e => paint(e.detail?.ctx?.target?.parentElement || document));

    // ── the cheat sheet (keys.help, "?"): every binding of the keymap with its command, grouped by the
    // command's group; commands without a key are listed last. Built here from the same table, so it
    // never disagrees with what the keys do. Its own scope `help` closes it (Escape, ?).
    const sheet = () => document.getElementById('keys-help');
    const sheetOpen = () => !!sheet() && !sheet().hidden;
    scopes.help = sheetOpen;
    const closeSheet = () => { if (sheet()) sheet().hidden = true; };
    function openSheet() {
        let el = sheet();
        if (!el) {
            el = document.createElement('div');
            el.id = 'keys-help';
            el.className = 'w-palette keys-help';
            el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-keys-help-close]')) closeSheet(); });
            document.body.appendChild(el);
        }
        const byCommand = new Map();
        for (const b of data.bindings || []) {
            const scope = b.scope || 'global';
            if (scope === 'help') continue;
            const row = byCommand.get(b.command + ' ' + scope) || { command: b.command, scope, keys: [] };
            row.keys.push(String(b.keys));
            byCommand.set(b.command + ' ' + scope, row);
        }
        const groups = new Map();
        const add = (group, row) => { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(row); };
        for (const row of byCommand.values()) {
            const c = commands[row.command];
            add(row.scope === 'global' ? (c?.group || row.command.split('.')[0]) : `${row.scope} (while open)`, { ...row, title: c?.title || row.command, missing: !c });
        }
        const unbound = Object.entries(commands).filter(([id]) => ![...byCommand.values()].some(r => r.command === id) && !id.startsWith('keys.'));
        for (const [id, c] of unbound) add('without a key', { command: id, title: c.title || id, keys: [] });
        const section = ([group, rows]) => `<section class="keys-help-group"><h3>${esc(group)}</h3><dl>${rows.map(r =>
            `<div${r.missing ? ' data-missing title="No such command on this page"' : ''}><dt>${r.keys.length ? caps(r.keys) : '<span class="keys-help-none">—</span>'}</dt><dd>${esc(r.title)} <code>${esc(r.command)}</code></dd></div>`).join('')}</dl></section>`;
        el.innerHTML = `<div class="w-palette-box" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">`
            + `<div class="keys-help-head"><strong>Keyboard shortcuts</strong><span>keymap <code>${esc(data.keymap)}</code> · change in settings <code>keys.keymap</code>, <code>keys.bindings</code></span><button type="button" class="keys-help-x" data-keys-help-close aria-label="Close">${cap(['Esc'])}</button></div>`
            + `<div class="w-palette-body keys-help-body">${[...groups].map(section).join('')}</div></div>`;
        el.hidden = false;
        el.querySelector('.keys-help-x')?.focus();
    }
    commands['keys.help'] = { title: 'Keyboard shortcuts', group: 'help', run: () => sheetOpen() ? closeSheet() : openSheet() };
    commands['keys.helpClose'] = { title: 'Close the shortcuts', group: 'help', run: closeSheet, when: sheetOpen };

    window.hyperKeys = Object.freeze({ keymap: data.keymap, bindings: data.bindings || [], handle, label, paint, help: openSheet, chord: eventChord, platformChord });
})();
