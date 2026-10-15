/** POST /code/tests/run?kind=fast|it|live|all — starts that kind of tests in the background (code.runTests). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const q = new URL(opts.req.url).searchParams.get("kind") ?? "fast";
    if (!["fast", "it", "live", "all"].includes(q)) return Response.json({ error: "invalid kind: " + q }, { status: 400 });
    return Response.json(await ctx.fns.code.runTests({ kind: q as types.code.TestKind }));
}
