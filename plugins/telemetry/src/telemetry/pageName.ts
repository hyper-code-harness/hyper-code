// A page name carries the day it was opened and the process that opened it, so
// two processes never append to the same file and a page can be placed in time
// without being read.
/**
 * Build the file name of a new NDJSON span page.
 *
 * @param opts.now Milliseconds used as the page's opening time; defaults to now.
 * @param opts.pid Process id embedded in the name; defaults to this process.
 */
export default function (_ctx: Context, _session: Session | null, opts?: {
    /** Milliseconds used as the page's opening time. */
    now?: number;
    /** Process id embedded in the name. */
    pid?: number;
}): string {
    const stamp = new Date(opts?.now ?? Date.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
    return `spans-${stamp}-${opts?.pid ?? process.pid}.ndjson`;
}
