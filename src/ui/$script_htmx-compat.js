// TEMPORARY bridge for the htmx 2 → 4 migration (see .hyper/htmx-migration/).
// Loaded right after /procs/ui/htmx.js by ui/layout. It re-fires the old htmx 2
// event names next to the new ones and maps the removed defineExtension onto
// registerExtension, so the app keeps working while handlers are ported one by
// one. Delete this file (and its <script> tag) once the `events` task is done.
import "htmx.org/dist/ext/htmx-2-compat.js";

if (window.htmx && !window.htmx.defineExtension) {
  window.htmx.defineExtension = (name, ext) => window.htmx.registerExtension(name, ext);
}
