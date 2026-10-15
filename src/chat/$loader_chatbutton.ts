// `$chatbutton_<name>.ts` — a chat header button (see types.chat.Button). Id is `<module>.<name>`
// (agent/$chatbutton_workspace.ts → agent.workspace; in the chat module itself just `<name>`).

/**
 * Registers `$chatbutton_<name>` files in ctx.state.chat.parts.
 * @param opts.entries The classified chat button files to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    await ctx.fns.chat.register({ kind: "button", entries: opts.entries });
}
