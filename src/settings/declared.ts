// Lists every declared setting (from $setting_*.ts files registered into
// ctx.state.settings.registry) with its current resolved value and source.
// Used by the /settings/declared UI route — DB is consulted to detect overrides
// but is never written from here.
type DeclaredItem = {
    module: string;
    key: string;
    descriptor: any;
    currentValue: any;
    source: 'file' | 'db' | 'env' | 'default';
    /** Instance settings file that fixes the value (source = file). */
    path?: string;
};

/** Lists declared settings with their resolved values and provenance. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<DeclaredItem[]> {
    const registry: Map<string, any> | undefined = (ctx.state as any).settings?.registry;
    if (!registry) return [];

    const files = (await ctx.fns.settings.files({})).values;
    const out: DeclaredItem[] = [];
    for (const [regKey, descriptor] of registry.entries()) {
        const dotIdx = regKey.indexOf('.');
        if (dotIdx <= 0) continue;
        const module = regKey.slice(0, dotIdx);
        const key = regKey.slice(dotIdx + 1);

        const fixed = files[regKey];
        if (fixed) { out.push({ module, key, descriptor, currentValue: fixed.value, source: 'file', path: fixed.path }); continue; }
        // Detect provenance.
        const dbRow = (await ctx.fns.procs.db.select({
            sql: "SELECT value FROM settings WHERE module = ? AND scope_type = 'global' AND scope_id = '' AND key = ?",
            params: [module, key],
        }) as Array<{ value: string }>)[0];

        let source: 'db' | 'env' | 'default';
        let currentValue: any;
        if (dbRow) {
            source = 'db';
            currentValue = JSON.parse(dbRow.value);
        } else if (descriptor.env && ctx.env[descriptor.env] != null) {
            source = 'env';
            const raw = String(ctx.env[descriptor.env]);
            currentValue = descriptor.type === 'number' ? Number(raw)
                : descriptor.type === 'boolean' ? (raw === 'true' || raw === '1')
                : raw;
        } else {
            source = 'default';
            currentValue = descriptor.default;
        }

        out.push({ module, key, descriptor, currentValue, source });
    }

    out.sort((a, b) => (a.module + a.key).localeCompare(b.module + b.key));
    return out;
}
