/** Returns the people who can be @mentioned, as JSON for the composer's suggestions. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    return Response.json(await ctx.fns.mentions.people({}), { headers: { "cache-control": "no-store" } });
}
