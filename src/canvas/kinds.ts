/**
 * Lists the canvas kinds that are loaded (file and plugin kinds) with what each shows and its args.
 * Use before canvas.show to see what can be opened on an agent's canvas.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): Array<{ name: string; module: string; hint: string | null }> {
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    return Object.values(kinds).sort((a, b) => a.name.localeCompare(b.name)).map(k => ({ name: k.name, module: k.module, hint: k.hint ?? null }));
}
