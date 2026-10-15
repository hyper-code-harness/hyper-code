// Resolution chain:
//   0. Instance settings file ~/.hyper/settings/$settings_<module>.json — only for scope='global'
//      (settings.files); a key fixed there wins over the database.
//   1. DB row (explicit override).
//   2. Declared default — only for scope='global':
//        a. descriptor.env  → ctx.env[<that>] (parsed by descriptor.type)
//        b. descriptor.default
//   3. undefined (caller may use its own fallback).
type GetOpts = {
    /** Setting namespace. */
    module: string;
    /** Scope category, such as `global` or `agent`. */
    scopeType: string;
    /** Scope identifier; omitted values address the empty/global scope. */
    scopeId?: string | null;
    /** Setting key within the module. */
    key: string;
};

function parseEnv(raw: string, type?: string): any {
    if (type === 'number')  return Number(raw);
    if (type === 'boolean') return raw === 'true' || raw === '1';
    return raw;
}

/** Resolves a setting from the database or its declared global default. */
export default async function (ctx: Context, _session: Session | null, opts: GetOpts): Promise<any> {
    if ((opts.scopeType ?? 'global') === 'global' && !opts.scopeId) {
        const fixed = (await ctx.fns.settings.files({})).values[`${opts.module}.${opts.key}`];
        if (fixed) return fixed.value;
    }
    const row = (await ctx.fns.procs.db.select({
        sql: `SELECT value
           FROM settings
          WHERE module = ?
            AND scope_type = ?
            AND scope_id = ?
            AND key = ?`,
        params: [opts.module, opts.scopeType, opts.scopeId ?? '', opts.key],
    }) as Array<{ value: string }>)[0];
    if (row) return JSON.parse(row.value);

    // Declared default — only consulted for scope='global'. Per-instance scopes
    // (per-agent / per-provider) by definition can't be pre-declared.
    if ((opts.scopeType ?? 'global') === 'global') {
        const desc = (ctx.state as any).settings?.registry?.get(`${opts.module}.${opts.key}`);
        if (desc) {
            if (desc.env && ctx.env[desc.env] != null) {
                return parseEnv(String(ctx.env[desc.env]), desc.type);
            }
            if (desc.default !== undefined) return desc.default;
        }
    }

    return undefined;
}
