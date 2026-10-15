// The files of one kind of tests, as script/test.ts lists them (the one place
// that knows the naming rule), each with what the last full run of that kind
// said about it — so the Tests page can offer them for a picked run.

/**
 * Lists the test files of one kind (fast *.test.ts, it *.it.test.ts, live *.live.test.ts, all = fast + it), each with its tests, failures and time in the last full run of that kind.
 * Use to choose files for code.runTests({ kind, path }) — for instance only the files that failed last time.
 * @param opts.kind Which kind of test files to list. @default "fast"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Which kind of test files to list. @default "fast" */
    kind?: types.code.TestKind;
}): Promise<{ file: string; tests: number | null; failures: number | null; ms: number | null }[]> {
    const kind: types.code.TestKind = opts.kind ?? "fast";
    if (!["fast", "it", "live", "all"].includes(kind)) throw new Error("invalid test kind: " + kind);
    const ws = String((ctx.state as any).root);
    const p = Bun.spawn({ cmd: ["bun", "script/test.ts", kind, "--list"], cwd: ws, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    if (code !== 0) throw new Error("script/test.ts --list failed: " + err.trim());
    const files = out.split("\n").filter(Boolean);

    const last: Record<string, { tests: number; failures: number; ms: number }> = {};
    const xf = Bun.file(`${ws}/.runtime/test-report-${kind}.xml`);
    if (await xf.exists()) {
        for (const m of (await xf.text()).matchAll(/<testsuite name="([^"]*)" file="([^"]*)" tests="(\d+)"[^>]*failures="(\d+)"[^>]*time="([\d.]+)"/g))
            if (m[1] === m[2]) last[m[2]!] = { tests: +m[3]!, failures: +m[4]!, ms: Math.round(+m[5]! * 1000) };
    }
    return files.map(file => ({ file, tests: last[file]?.tests ?? null, failures: last[file]?.failures ?? null, ms: last[file]?.ms ?? null }));
}
