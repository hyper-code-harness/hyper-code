/** Collects `$app_<name>.json` declarations into the global navigation registry. */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    // Boot hands over every $app_ file, a hot reload just the one that changed: merge by name so reloading
    // one page never drops the others.
    const apps: Record<string, { name: string; label: string; href: string; hint: string; icon: string; group: string; order: number; plugin?: boolean }> =
        { ...((ctx.state as any).nav?.apps ?? {}) };
    for (const entry of opts.entries) {
        const raw = JSON.parse(await Bun.file(entry.abs).text());
        const href = String(raw.href ?? "").trim();
        const label = String(raw.label ?? entry.name ?? "").trim();
        const hint = String(raw.hint ?? "page").trim();
        const icon = String(raw.icon ?? "ph-gear").trim();
        const group = String(raw.group ?? "System").trim();
        const order = Number(raw.order ?? 100);
        if (!label || !href.startsWith("/") || href.startsWith("//")) throw new Error(`${entry.rel}: $app declaration requires { label, href } with a local absolute URL`);
        if (!/^ph-[a-z0-9-]+$/.test(icon)) throw new Error(`${entry.rel}: $app icon must be a Phosphor class such as ph-clock`);
        if (!group || !Number.isFinite(order)) throw new Error(`${entry.rel}: $app group must be non-empty and order must be finite`);
        // `plugin` marks pages declared outside the core tree (official and user plugins): the menu lists them
        // on its Plugins tab instead of Home.
        apps[entry.name] = { name: entry.name, label, href, hint, icon, group, order, ...(entry.root && entry.root !== "core" ? { plugin: true } : {}) };
    }
    ((ctx.state as any).nav ??= {}).apps = apps;
}
