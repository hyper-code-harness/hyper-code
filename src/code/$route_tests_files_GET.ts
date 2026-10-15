/** GET /code/tests/files?kind=fast|it|live|all — the test files of that kind with their last results (code.testFiles), for picking files to run. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const q = new URL(opts.req.url).searchParams.get("kind") ?? "fast";
    if (!["fast", "it", "live", "all"].includes(q)) return Response.json({ error: "invalid kind: " + q }, { status: 400 });
    return Response.json(await ctx.fns.code.testFiles({ kind: q as types.code.TestKind }));
}
