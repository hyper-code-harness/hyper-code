/** GET /code/tests/status — whether a background test run is in progress (code.testRunStatus). */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request }) {
    return Response.json(ctx.fns.code.testRunStatus({}));
}
