// Resources available in the global menu: declarative app pages, installed
// plugins, and agent chats. Static pages are owned by `$app_*.json` files.
/**
 * Lists navigation destinations for declared apps, plugins, and agent chats.
 * @param opts.q Optional case-insensitive filter applied to labels, URLs, and hints.
 * @param opts.limit Maximum number of navigation items to return.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { q?: string; limit?: number },
): Promise<types.nav.Item[]> {
    const q = (opts.q ?? "").trim().toLowerCase();
    const limit = opts.limit ?? 20;

    const apps: types.nav.Item[] = Object.values((ctx.state as any).nav?.apps ?? {})
        .sort((a: any, b: any) => Number(a.order) - Number(b.order) || String(a.label).localeCompare(String(b.label)))
        .map((app: any): types.nav.Item => ({
            label: String(app.label), href: String(app.href), hint: String(app.hint ?? "page"),
            icon: String(app.icon ?? "ph-gear"), group: String(app.group ?? "System"), order: Number(app.order ?? 100),
        }));


    // Parameterless GET pages are valid destinations even when their owner did
    // not add an $app manifest. Assets, APIs and fragment endpoints stay out.
    const represented = new Set(apps.map(item => item.href));
    const pages: types.nav.Item[] = Object.entries((ctx.state as any).procs?.http?.routes ?? {})
        .filter(([path, methods]: [string, any]) => methods?.GET && !path.includes(":") && isPageRoute(path) && !represented.has(path))
        .map(([path, methods]: [string, any]): types.nav.Item => {
            const source = String(methods.GET?.from ?? "");
            const plugin = source && !source.startsWith("core/") ? source.split("/")[0] : null;
            return {
                label: pageLabel(path), href: path,
                hint: `${plugin ? `plugin page · ${plugin}` : "system page"} · ${path}`,
                icon: "ph-browser", group: "Pages",
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    const seenPluginPaths = new Set<string>();
    const plugins: types.nav.Item[] = ctx.fns.plugins.list({})
        .filter((plugin: any) => {
            const identity = plugin.path || plugin.name;
            if (seenPluginPaths.has(identity)) return false;
            seenPluginPaths.add(identity);
            return true;
        })
        .map((plugin: any): types.nav.Item => ({
            label: plugin.label || plugin.name,
            href: `/plugins/${encodeURIComponent(plugin.name)}`,
            hint: `plugin · ${plugin.description || plugin.namespaces?.join(", ") || plugin.name}`,
            icon: "ph-plugs", group: "Plugins",
        }));

    const agents = (await ctx.fns.session.list({}).catch(() => [])).map((agent: any): types.nav.Item => ({
        label: `${agent.id} · ${String(agent.title ?? "").slice(0, 60)}`,
        href: `/agent/${encodeURIComponent(agent.id)}`,
        hint: `agent · ${agent.model} · ${agent.turns} turns`,
        group: "Chats",
    }));

    const all = [...apps, ...pages, ...plugins, ...agents];
    const hit = (item: types.nav.Item) => !q || item.label.toLowerCase().includes(q) || item.href.toLowerCase().includes(q) || (item.hint ?? "").toLowerCase().includes(q);
    return all.filter(hit).slice(0, limit);
}


function isPageRoute(path: string): boolean {
    if (path === "/" || /\.(?:js|css|map|ico|png|jpg|jpeg|svg|md)$/i.test(path)) return false;
    if (/^\/(?:api|external|nav|procs)(?:\/|$)/.test(path)) return false;
    if (/\/(?:raw|status|usage|accounts|jobs|dirs)(?:\/|$)/.test(path)) return false;
    return true;
}

function pageLabel(path: string): string {
    const words = path.split("/").filter(Boolean).map(part => decodeURIComponent(part).replace(/[-_]+/g, " "));
    const label = words.join(" · ");
    return label ? label.replace(/\b\w/g, char => char.toUpperCase()) : "Home";
}
