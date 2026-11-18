// The page's single theme controller. Load synchronously before stylesheets so the first
// paint, native controls, and later Dock replacements all use the same resolved theme.
// Stored light/dark choices override the system; removing the key restores system mode.
(() => {
    if (window.hyperTheme) return;
    const key = 'hyper-theme';
    const root = document.documentElement;
    const choice = value => value === 'light' || value === 'dark' ? value : null;
    let storage = null;
    let preference = null;
    try {
        storage = window.localStorage;
        preference = choice(storage.getItem(key));
    } catch (_) { /* Storage can be blocked; system mode and in-tab choices still work. */ }
    const system = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function paint() {
        const dark = root.dataset.theme === 'dark';
        const name = dark ? 'Dark' : 'Light';
        const button = document.getElementById('theme-toggle');
        if (button) {
            button.setAttribute('aria-pressed', String(dark));
            button.setAttribute('aria-label', `Theme: ${preference ? name : 'System, ' + name}. Use ${dark ? 'light' : 'dark'} theme`);
            button.title = `Use ${dark ? 'light' : 'dark'} theme`;
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.remove('ph-sun', 'ph-moon');
                icon.classList.add(dark ? 'ph-moon' : 'ph-sun');
            }
            const hint = button.querySelector('[data-theme-name], .w-row-hint');
            const text = preference ? name : `System · ${name}`;
            if (hint && hint.textContent !== text) hint.textContent = text;
        }
        const automatic = document.getElementById('theme-system');
        if (automatic) {
            automatic.setAttribute('aria-pressed', String(preference === null));
            const hint = automatic.querySelector('.w-row-hint');
            const text = preference === null ? 'On' : 'Off';
            if (hint && hint.textContent !== text) hint.textContent = text;
        }
    }

    function apply() {
        const theme = preference ?? (system?.matches ? 'dark' : 'light');
        root.dataset.theme = theme;
        root.dataset.themePreference = preference ?? 'system';
        root.style.colorScheme = theme;
        paint();
    }

    function set(mode) {
        if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return;
        preference = choice(mode);
        try {
            if (preference === null) storage?.removeItem(key);
            else storage?.setItem(key, preference);
        } catch (_) { /* Keep this tab's choice when persistence is unavailable. */ }
        apply();
    }

    window.hyperTheme = { set, paint };
    apply();
    system?.addEventListener('change', () => { if (preference === null) apply(); });
    window.addEventListener('storage', event => {
        if (event.storageArea !== storage || (event.key !== key && event.key !== null)) return;
        preference = event.key === null ? null : choice(event.newValue);
        apply();
    });
    document.addEventListener('click', event => {
        if (event.target.closest?.('#theme-toggle')) set(root.dataset.theme === 'dark' ? 'light' : 'dark');
        else if (event.target.closest?.('#theme-system')) set('system');
    });
    document.addEventListener('DOMContentLoaded', paint);
    document.addEventListener('htmx:after:swap', paint);
    document.addEventListener('htmx:afterSwap', paint);
})();
