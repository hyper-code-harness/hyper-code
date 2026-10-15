/**
 * POST /code/tests/run?kind=fast|it|live|all — starts that kind of tests in the background (code.runTests).
 * A JSON body { files: string[] } runs only those test files (a picked run with its own report).
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const q = new URL(opts.req.url).searchParams.get("kind") ?? "fast";
    if (!["fast", "it", "live", "all"].includes(q)) return Response.json({ error: "invalid kind: " + q }, { status: 400 });
    const body = (opts.req.headers.get("content-type") ?? "").includes("json") ? await opts.req.json().catch(() => null) : null;
    const files = body?.files;
    if (files !== undefined && (!Array.isArray(files) || !files.length || files.some((f: unknown) => typeof f !== "string")))
        return Response.json({ error: "files must be a non-empty list of test file paths" }, { status: 400 });
    try {
        return Response.json(await ctx.fns.code.runTests({ kind: q as types.code.TestKind, ...(files ? { path: files } : {}) }));
    } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
    }
}
