/**
 * The effective key bindings: the chosen keymap (setting keys.keymap) with what it extends, every
 * module's part of it, and the personal overrides (setting keys.bindings) on top.
 *
 * Layers, first to last: the extended keymap (recursively), then the keymap itself, then the
 * personal bindings. Inside one keymap the keys module comes first and other modules follow in
 * name order; a module binding a key another module already bound in the same keymap is a conflict
 * — the first one stays. A later layer (a keymap over what it extends, the personal bindings) may
 * rebind or unbind (null) any key on purpose. Bindings are per scope: "global" (a keymap's `bind`) or a
 * named one (its `scopes.<name>`); the personal setting uses "<scope>:<keys>" for a named scope.
 * @param opts.keymap Keymap to resolve instead of the keys.keymap setting.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Keymap to resolve instead of the keys.keymap setting. */
    keymap?: string;
}): Promise<{
    keymap: string;
    bindings: Array<{ scope: string; keys: string; command: string; args?: unknown[]; inInput?: boolean; from: string }>;
    conflicts: Array<{ scope: string; keys: string; kept: string; dropped: string }>;
}> {
    const maps: Record<string, Record<string, any>> = (ctx.state as any).keys?.maps ?? {};
    const wanted = opts?.keymap ?? await ctx.fns.settings.get({ module: "keys", scopeType: "global", key: "keymap" }).catch(() => undefined);
    const keymap = typeof wanted === "string" && maps[wanted] ? wanted : "default";
    type Bound = { command: string; args?: unknown[]; inInput?: boolean; from: string };
    // Keyed "<scope> <keys>": the scope name never contains a space, the keys may (a sequence).
    const table = new Map<string, Bound | null>();
    const conflicts: Array<{ scope: string; keys: string; kept: string; dropped: string }> = [];
    const bound = (value: unknown, from: string): Bound | null => value === null ? null : typeof value === "string"
        ? { command: value, from }
        : { command: (value as any).command, args: Array.isArray((value as any).args) ? (value as any).args : undefined, inInput: (value as any).inInput === true || undefined, from };

    const apply = (name: string, seen: Set<string>) => {
        if (seen.has(name) || !maps[name]) return;
        seen.add(name);
        const parts = Object.values(maps[name]).sort((a: any, b: any) =>
            a.module === "keys" ? -1 : b.module === "keys" ? 1 : String(a.module).localeCompare(String(b.module)));
        const base = parts.map((p: any) => p.extends).find(Boolean);
        if (base) apply(base, seen);
        const mine = new Map<string, string>();
        for (const part of parts as any[]) {
            for (const [scope, binds] of Object.entries(part.scopes ?? {})) {
                for (const [raw, value] of Object.entries(binds as Record<string, unknown>)) {
                    const keys = normalize(raw);
                    const slot = `${scope} ${keys}`;
                    const owner = mine.get(slot);
                    if (owner && owner !== part.rel) { conflicts.push({ scope, keys, kept: owner, dropped: part.rel }); continue; }
                    mine.set(slot, part.rel);
                    table.set(slot, bound(value, part.rel));
                }
            }
        }
    };
    apply(keymap, new Set());

    const personal = await ctx.fns.settings.get({ module: "keys", scopeType: "global", key: "bindings" }).catch(() => ({}));
    if (personal && typeof personal === "object") {
        for (const [raw, value] of Object.entries(personal as Record<string, unknown>)) {
            const m = /^([a-z][a-zA-Z0-9-]*):(.+)$/.exec(raw);
            const slot = `${m ? m[1] : "global"} ${normalize(m ? m[2]! : raw)}`;
            if (value === null || typeof value === "string" || (value && typeof value === "object" && typeof (value as any).command === "string"))
                table.set(slot, bound(value, "setting keys.bindings"));
        }
    }

    const bindings = [...table].filter(([, v]) => v).map(([slot, v]) => {
        const at = slot.indexOf(" ");
        return { scope: slot.slice(0, at), keys: slot.slice(at + 1), ...v! };
    });
    return { keymap, bindings, conflicts };
}

// One spelling per chord, so "Shift-Ctrl-X" and "Ctrl-Shift-x" are the same key: modifiers in a fixed
// order (Ctrl Alt Shift Meta Mod), a one-letter key in lower case. Steps of a sequence keep their order.
function normalize(keys: string): string {
    const order = ["Ctrl", "Alt", "Shift", "Meta", "Mod"];
    const alias: Record<string, string> = { c: "Ctrl", control: "Ctrl", ctrl: "Ctrl", a: "Alt", alt: "Alt", m: "Meta", meta: "Meta", cmd: "Meta", s: "Shift", shift: "Shift", mod: "Mod" };
    return keys.trim().split(/\s+/).map(step => {
        const parts = step.split(/-(?!$)/);
        const key = parts.pop()!;
        const mods = [...new Set(parts.map(p => alias[p.toLowerCase()] ?? p))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return [...mods, key.length === 1 ? key.toLowerCase() : key].join("-");
    }).join(" ");
}
