/**
 * Builds the Dock entries for what the current person pinned: chats (`agent:<id>`) and pages (`page:<href>`).
 *
 * Chats come from the person's pins in user_agent_state (the same pins the global menu and the mobile app
 * show) and draw the chat's model logo with a dot when it has news the person has not seen; archived chats
 * are skipped. Pages come from layout.pins and take their icon and label from the declared `$app_` pages
 * when the href matches one. Pinned entries default to the top zone after the plugin entries.
 * @param opts.pages Page hrefs pinned in the effective layout.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Page hrefs pinned in the effective layout. */
        pages?: string[];
    },
): Promise<types.dock.Registered[]> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const viewer = await ctx.fns.auth.viewerId({}).catch(() => null);
    const ids = [...await ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>())];
    const rows = ids.length ? await ctx.fns.procs.db.select({
        sql: `SELECT a.id, COALESCE(NULLIF(a.title, ''), a.id) AS title, a.model, a.icon, a.run_state AS "runState",
                     (? <> '' AND a.last_notifiable_at IS NOT NULL AND a.last_notifiable_at > COALESCE(s.seen_at, -1)) AS unread
                FROM agents a LEFT JOIN user_agent_state s ON s.agent_id = a.id AND s.user_id = ?
               WHERE a.archived_at IS NULL AND a.id = ANY(string_to_array(?::text, ','))`,
        params: [viewer ?? "", viewer ?? "", ids.join(",")],
    }) as any[] : [];
    const byId = new Map(rows.map(r => [String(r.id), r]));
    const chats: types.dock.Registered[] = ids.filter(id => byId.has(id)).map((id, index) => {
        const a = byId.get(id);
        const label = `${a.title} (${id})`;
        return {
            id: `agent:${id}`, module: "dock", rel: "user_agent_state", zone: "top", order: 1000 + index, label, pinned: "agent",
            render: () => `<a href="/agent/${encodeURIComponent(id)}" class="relative flex size-7 items-center justify-center rounded-md hover:bg-base-300" title="${esc(label)}" aria-label="${esc(label)}">${ctx.fns.chat.icon({ icon: a.icon, model: a.model, active: a.runState !== "idle" })}${a.unread === true || a.unread === "t" ? '<span class="pointer-events-none absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success" aria-label="New activity"></span>' : ""}</a>`,
        };
    });
    const apps = Object.values(((ctx.state as any).nav?.apps ?? {}) as Record<string, { href: string; label: string; icon: string }>);
    const pages: types.dock.Registered[] = (opts.pages ?? []).map((href, index) => {
        const app = apps.find(x => x.href === href);
        return { id: `page:${href}`, module: "dock", rel: "dock.layout", zone: "top", order: 2000 + index, pinned: "page", icon: app?.icon ?? "ph-file", label: app?.label ?? href, href };
    });
    return [...chats, ...pages];
}
