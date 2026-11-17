// Same file as extensions/canvas-frames/frame.js (kept in both: either extension alone is enough).
// Runs in every frame, but acts only in a page framed directly by a Hyper page (a canvas url tab): it
// tells the Hyper page where the frame is now — after a link, a form, or a single-page app's history
// change — so the canvas address bar follows the site. A cross-origin parent cannot read this itself.
(() => {
  if (window.top === window || window.parent !== window.top) return;
  const parent = location.ancestorOrigins?.[0] || '';
  if (!/^(https:\/\/([a-z0-9-]+\.)*hyper-mesh\.xyz|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(parent)) return;
  let sent = '';
  const report = () => {
    const now = location.href + '\n' + document.title;
    if (now === sent || !/^https?:/.test(location.href)) return;
    sent = now;
    window.parent.postMessage({ hyperFrames: 1, type: 'location', url: location.href, title: document.title }, parent);
  };
  report();
  addEventListener('DOMContentLoaded', report);
  addEventListener('load', report);
  addEventListener('popstate', report);
  addEventListener('hashchange', report);
  // pushState in the page's own world is invisible here; a cheap poll catches it.
  setInterval(report, 1000);
})();
