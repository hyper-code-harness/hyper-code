// `$chatcard_<name>.ts` — a chat header card (see types.chat.Card). Id is `<module>.<name>`
// (agent/$chatcard_workspace.ts → agent.workspace; in the chat module itself just `<name>`).

/**
 * Registers `$chatcard_<name>` files in ctx.state.chat.parts.
 * @param opts.entries The classified chat card files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    await ctx.fns.chat.register({ kind: "card", entries: opts.entries });
}
