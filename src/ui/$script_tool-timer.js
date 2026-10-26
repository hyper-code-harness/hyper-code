// Counts the seconds of a running tool call in the browser.
//
// The server renders the start/deadline as data attributes and never the text:
// a ticking label computed server-side would cost one HTTP request per second
// per open tab to say something the client already knows. Same shape as
// wake-timer.js.
(() => {
  if (window.__hyperToolTimerInstalled) return;
  window.__hyperToolTimerInstalled = true;

  const clock = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0');
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  };

  const tick = () => {
    document.querySelectorAll('.w-timer[data-since]').forEach((el) => {
      const started = Number(el.dataset.since);
      if (!Number.isFinite(started)) return;
      const elapsed = Date.now() - started;
      // The short clock at the end of the tool row: just how long, "12s" / "3m 05s".
      if (el.dataset.format !== 'clock') {
        const t = Math.max(0, Math.round(elapsed / 1000));
        el.textContent = t < 60 ? t + 's' : Math.floor(t / 60) + 'm ' + String(t % 60).padStart(2, '0') + 's';
        return;
      }
      const deadline = Number(el.dataset.deadline);
      // "running 27:10 of 30:00" answers "should I keep waiting?".
      // Without a declared timeout only the elapsed time is honest.
      if (Number.isFinite(deadline) && deadline > started) {
        el.textContent = 'running ' + clock(elapsed) + ' of ' + clock(deadline - started);
        // Past its own deadline the tool is in the kill path; say so rather
        // than showing a number larger than the limit with no explanation.
        el.toggleAttribute('data-late', Date.now() > deadline);
      } else {
        el.textContent = 'running ' + clock(elapsed);
      }
    });
  };
  tick();
  setInterval(tick, 1000);
  document.addEventListener('htmx:afterSwap', tick);
})();
