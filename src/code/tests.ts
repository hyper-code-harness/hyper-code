// The last test run, read back from the files `bun test` leaves in .runtime/:
// per-file timings (--timings) and the JUnit report (--reporter=junit).
// code.runTests writes both; the Tests canvas (code.tests kind) shows this.

type Snip = { line: number; html: string } | null;
type T = { name: string; cls: string; s: number; file: string; code?: Snip };
type F = T & { type: string; msg: string };

const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Summarises the last full test run: totals, slowest files with their slowest tests, slowest tests and failures, each with a highlighted code snippet of the test.
 * Use to look at test speed and failures without rerunning; returns null when no run has been recorded yet. Start a fresh run with code.runTests.
 * @param opts.kind Which run to read: fast (*.test.ts), it (*.it.test.ts), live (*.live.test.ts) or all. @default "fast"
 * @param opts.picked Read the last run of picked files (code.runTests with a path) instead of the full run of the kind. @default false
 * @param opts.top How many slow files and slow tests to list. @default 10 @minimum 1 @maximum 50
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** How many slow files and slow tests to list. @default 10 @minimum 1 @maximum 50 */
    top?: number;
    /** Which run to read: fast (*.test.ts), it (*.it.test.ts), live (*.live.test.ts) or all. @default "fast" */
    kind?: types.code.TestKind;
    /** Read the last run of picked files (code.runTests with a path) instead of the full run of the kind. @default false */
    picked?: boolean;
}): Promise<{
    tests: number; failures: number; skipped: number; wall: number; nfiles: number; total: number; at: number | null;
    top: { f: string; ms: number; tests: T[] }[]; slowTests: T[]; fails: F[];
    run: types.code.TestRun | { running: false };
} | null> {
    const ws = String((ctx.state as any).root);
    const kind: types.code.TestKind = opts.kind ?? "fast";
    if (!["fast", "it", "live", "all"].includes(kind)) throw new Error("invalid test kind: " + kind);
    const xf = Bun.file(`${ws}/.runtime/test-report-${opts.picked ? "picked" : kind}.xml`);
    const run = ctx.fns.code.testRunStatus({});
    if (!(await xf.exists())) return null;
    const xml = await xf.text();
    const head = xml.match(/<testsuites [^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*skipped="(\d+)"[^>]*time="([\d.]+)"/);
    const n = Math.max(1, Math.min(50, opts.top ?? 10));

    const all: T[] = [...xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)" time="([\d.]+)" file="([^"]*)"/g)]
        .map(x => ({ name: unxml(x[1]!), cls: unxml(x[2]!), s: +x[3]!, file: x[4]! }));
    const fails: F[] = [];
    for (const m of xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)" time="([\d.]+)" file="([^"]*)"[^>]*>\s*<failure type="([^"]*)" message="([^"]*)"/g))
        fails.push({ name: unxml(m[1]!), cls: unxml(m[2]!), s: +m[3]!, file: m[4]!, type: m[5]!, msg: m[6]!.slice(0, 160) });
    const slowTests = [...all].sort((a, b) => b.s - a.s).slice(0, n);
    // per-file time from this run's report: the timings file is merged across runs and keeps deleted files
    const files = [...xml.matchAll(/<testsuite name="([^"]*)" file="([^"]*)"[^>]*time="([\d.]+)"/g)]
        .filter(m => m[1] === m[2]).map(m => [m[0], m[2], m[3]] as const)   // top-level suites only, not describe blocks
        .map(m => ({ f: m[1]!, ms: Math.round(+m[2]! * 1000) })).sort((a, b) => b.ms - a.ms);
    const top = files.slice(0, n).map(f => ({
        ...f,
        tests: all.filter(t => t.file === f.f || "src/" + t.file === f.f).sort((a, b) => b.s - a.s).slice(0, 15).map(t => ({ ...t })),
    }));

    // Test source: the report's file is relative to whichever root the run used.
    const roots = [ws, ws + "/src", ws + "/plugins", ...(ctx.env.USER_PLUGINS ? [String(ctx.env.USER_PLUGINS)] : [])];
    const cache: Record<string, string | null> = {};
    const src = async (file: string) => {
        if (file in cache) return cache[file]!;
        for (const r of roots) { const f = Bun.file(r + "/" + file); if (await f.exists()) return cache[file] = await f.text(); }
        return cache[file] = null;
    };
    const snippet = async (file: string, name: string): Promise<Snip> => {
        const s = await src(file); if (!s) return null;
        const lines = s.split("\n"), q = [JSON.stringify(name), "'" + name + "'", "`" + name + "`"];
        let i = lines.findIndex(l => /\b(test|it)(\.\w+)?\(/.test(l) && q.some(x => l.includes(x)));
        if (i < 0) i = lines.findIndex(l => l.includes(name));
        if (i < 0) return null;
        const ind = lines[i]!.match(/^\s*/)![0].length;
        let j = i + 1;
        for (; j < lines.length && j < i + 120; j++) { const L = lines[j]!; if (L.trim() && L.match(/^\s*/)![0].length <= ind && /^\s*[})\]]/.test(L)) break; }
        const html = (await ctx.fns.markdown.highlight({ code: lines.slice(i, j + 1).join("\n"), lang: "ts" }))
            // the canvas frame does not get the theme's CSS variables: inline the light colours
            .replace(/style="([^"]*)"/g, (_m: string, st: string) => {
                const c = st.match(/--shiki-light:(#[0-9a-fA-F]+)/), b = st.match(/--shiki-light-bg:(#[0-9a-fA-F]+)/);
                return c ? `style="color:${c[1]}"` : b ? `style="background:${b[1]}"` : "";
            });
        return { line: i + 1, html };
    };
    for (const t of [...slowTests, ...fails, ...top.flatMap(f => f.tests)]) t.code = await snippet(t.file, t.name);
    return {
        tests: +(head?.[1] ?? all.length), failures: +(head?.[2] ?? fails.length), skipped: +(head?.[3] ?? 0), wall: +(head?.[4] ?? 0),
        nfiles: files.length, total: files.reduce((s, x) => s + x.ms, 0), at: (await xf.stat()).mtime.getTime(), top, slowTests, fails, run,
    };
}
