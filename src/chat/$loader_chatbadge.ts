// `$chatbadge_<name>.ts` — a chat header badge (see types.chat.Badge). Id is `<module>.<name>`
// (agent/$chatbadge_workspace.ts → agent.workspace; in the chat module itself just `<name>`).

/**
 * Registers `$chatbadge_<name>` files in ctx.state.chat.parts.
 * @param opts.entries The classified chat badge files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    await ctx.fns.chat.register({ kind: "badge", entries: opts.entries });
}
