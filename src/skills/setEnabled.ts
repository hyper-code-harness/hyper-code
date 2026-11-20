/**
 * Turns Agent Skills on or off for every agent, or re-applies the stored choice
 *
 * Use from the Skills page button and at start. The `skill` tool is declared opt-in, so by default only agents that
 * name it in their tool list have it. With `on: true` every agent without a tool list of its own gets the tool and
 * the system-prompt section about plugins and skills (one more tool and about 2800 characters: the cached prompt
 * prefix of every live session moves once); `on: false` takes them back. The choice is kept in the `skills.enabled`
 * setting. Without `on` nothing is stored: the current setting is applied to this process, which is what start does.
 * Changing it is the person's decision — a call that carries an agent session is refused.
 * @param opts.on New state; omit to only apply the stored setting.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** New state; omit to only apply the stored setting. */
    on?: boolean;
} = {}): Promise<{ enabled: boolean; changed: boolean }> {
    const before = await ctx.fns.settings.get({ module: "skills", scopeType: "global", key: "enabled" }) === true;
    let enabled = before;
    if (opts.on !== undefined) {
        ctx.fns.skills.personOnly({ what: "turn skills on or off for every agent" });
        enabled = opts.on === true;
        if (enabled !== before) await ctx.fns.settings.set({ module: "skills", scopeType: "global", key: "enabled", value: enabled });
    }
    // tools.list reads this override, so the tool's schema, its prompt line and the call check all follow at once.
    const tools = ((ctx.state as any).tools ??= {});
    (tools.optIn ??= {})["skills.skill"] = !enabled;
    return { enabled, changed: enabled !== before };
}
