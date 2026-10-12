/**
 * Lists the canvas kinds that are loaded (file and plugin kinds) with what each shows and its args.
 * Use before canvas.show to see what can be opened on an agent's canvas.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<Array<{ name: string; module: string; hint: string | null }>> {
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    return await Promise.all(Object.values(kinds).sort((a, b) => a.name.localeCompare(b.name)).map(async k => {
        const hint = typeof k.hint === "function" ? await Promise.resolve(k.hint(ctx)).catch(() => null) : k.hint;
        return { name: k.name, module: k.module, hint: hint ?? null };
    }));
}
