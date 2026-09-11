/**
 * Hourly tick; `runtime.docs.localizeNightly` returns immediately outside its
 * night window. The cron loader only understands intervals, not wall-clock
 * times, so the hour check lives in the function.
 */
export default { fn: "runtime.docs.localizeNightly", every: "1h", args: {} };
