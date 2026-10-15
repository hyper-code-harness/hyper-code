/** POST /code/tests/run — starts the full test suite in the background (code.runTests). */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request }) {
    return Response.json(await ctx.fns.code.runTests({}));
}
