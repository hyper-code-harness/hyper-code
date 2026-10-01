// Keeps a CSS animation in phase across htmx swaps.
//
// A live region replaces its markup every few seconds. The browser treats the
// replacement as a brand-new element, so its animation restarts from frame
// zero — which a spinning ring shows as a visible jerk backwards, exactly the
// twitch that makes a calm indicator look unreliable.
//
// Nothing is stored: the phase is derived from the wall clock. An animation of
// duration D that began at epoch zero is, right now, (Date.now() % D) into its
// cycle, and a negative animation-delay of that amount starts the fresh element
// at precisely that point. The replacement therefore continues the motion of
// the element it replaced — and two elements with the same duration turn in
// lockstep, because both are reading the same clock rather than remembering
// their own history.
//
// Usage: put data-spin-sync on anything animated inside a live region. The
// duration comes from the element's own CSS, so this adds no second source of
// truth to keep in step with the stylesheet.
(() => {
  if (window.__hyperSpinSyncInstalled) return;
  window.__hyperSpinSyncInstalled = true;

  const ms = (value) => {
    const raw = String(value || '').split(',')[0].trim();
    if (!raw) return 0;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return 0;
    return raw.endsWith('ms') ? n : n * 1000;
  };

  const sync = (el) => {
    // Already phased: re-applying on every unrelated swap would recompute the
    // same answer and, mid-frame, is itself a chance to stutter.
    if (el.dataset.spinSynced === '1') return;
    const duration = ms(getComputedStyle(el).animationDuration);
    if (duration <= 0) return;
    el.style.animationDelay = `-${Date.now() % duration}ms`;
    el.dataset.spinSynced = '1';
  };

  const syncAll = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.matches?.('[data-spin-sync]')) sync(root);
    root.querySelectorAll?.('[data-spin-sync]').forEach(sync);
  };

  syncAll(document.body);
  // htmx:load fires for every newly inserted fragment, which is the moment a
  // replacement element exists but has not yet been painted.
  document.addEventListener('htmx:load', (e) => syncAll(e.target));
  document.addEventListener('htmx:afterSwap', (e) => syncAll(e.target));
})();
