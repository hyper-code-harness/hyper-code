/**
 * Draws the action buttons of a skill pack or one skill for the Skills pages: install, add, update, remove, allow to agents
 *
 * Use from skills.page, skills.view and skills.previewPage. Each button is a small form posted to POST /skills/act;
 * the answer replaces this block, and a successful change also refreshes every open Skills page. The buttons work
 * for a signed-in person only: the route refuses calls that carry an agent session, and the functions behind it
 * refuse them again (skills.personOnly). What is offered depends on the state: nothing installed → Install; some of
 * the repository installed → Add this skill / Install the rest / Update; installed → Remove, and allow or stop
 * letting agents pick the pack's skills. Removing asks for confirmation in the browser.
 * @param opts.repo Repository the buttons act on; with it, install and update are offered.
 * @param opts.pack Installed pack the buttons act on; with it, remove and allow are offered.
 * @param opts.skill One skill of the repository or pack: install or remove just it.
 * @param opts.installed Whether that skill is installed now.
 * @param opts.ref Tag, branch or commit to install from instead of the newest release.
 * @param opts.global Draw the one instance-wide switch instead: skills on or off for every agent.
 * @param opts.message Result of the last action, shown above the buttons.
 * @param opts.tone Tone of the message. @default "success"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository the buttons act on; with it, install and update are offered. */
    repo?: string;
    /** Installed pack the buttons act on; with it, remove and allow are offered. */
    pack?: string;
    /** One skill of the repository or pack: install or remove just it. */
    skill?: string;
    /** Whether that skill is installed now. */
    installed?: boolean;
    /** Tag, branch or commit to install from instead of the newest release. */
    ref?: string;
    /** Draw the one instance-wide switch instead: skills on or off for every agent. */
    global?: boolean;
    /** Result of the last action, shown above the buttons. */
    message?: string;
    /** Tone of the message. @default "success" */
    tone?: "success" | "danger";
}): Promise<string> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const { lock } = await ctx.fns.skills.lockFile({});
    const repo = opts.repo ?? (opts.pack ? lock.packs[opts.pack]?.repo : undefined);
    const packName = opts.pack ?? (repo ? Object.entries(lock.packs).find(([, e]) => e.repo === repo)?.[0] : undefined);
    const pack = packName ? lock.packs[packName] : undefined;
    // Keyed by repository and skill, not by pack name: the block keeps its id when installing gives the pack a name.
    const id = opts.global ? "skills-act-global" : "skills-act-" + new Bun.CryptoHasher("sha256").update(JSON.stringify([repo ?? opts.pack ?? "", opts.skill ?? ""])).digest("hex").slice(0, 12);
    // A change refreshes every open Skills page, this one included; the result of the click is kept for a moment so
    // the refresh does not wipe it.
    const state = ((ctx.state as any).skills ??= {}) as { lastAction?: { id: string; message: string; tone: "success" | "danger"; at: number } };
    if (opts.message) state.lastAction = { id, message: opts.message, tone: opts.tone ?? "success", at: Date.now() };
    const last = !opts.message && state.lastAction?.id === id && Date.now() - state.lastAction.at < 20_000 ? state.lastAction : null;
    const message = opts.message ?? last?.message;
    const tone = opts.message ? opts.tone ?? "success" : last?.tone ?? "success";

    // The token is read in the browser when the form is sent, from the page's own meta — never baked into a view.
    const csrf = `hx-headers='js:{"x-csrf-token": document.querySelector("meta[name=csrf-token]")?.content || ""}'`;
    const hidden = (fields: Record<string, string | undefined>) => Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
    const button = (label: string, fields: Record<string, string | undefined>, o: { tone?: "primary" | "danger" | "ghost"; confirm?: string } = {}) =>
        `<form hx-post="/skills/act" hx-target="#${id}" hx-swap="outerHTML" ${csrf}${o.confirm ? ` hx-confirm="${esc(o.confirm)}"` : ""} style="display:inline-flex">`
        + hidden({ repo, pack: packName, skill: opts.skill, ref: opts.ref, ...fields })
        + w.button({ label, size: "sm", tone: o.tone ?? "ghost", submit: true, marks: { action: "skills-" + fields.op } }) + `</form>`;

    const buttons: string[] = [];
    if (opts.global) {
        const on = await ctx.fns.settings.get({ module: "skills", scopeType: "global", key: "enabled" }) === true;
        buttons.push(on
            ? button("Turn skills off for all agents", { op: "disable" }, { confirm: "Take the skill tool away from every agent that does not name it itself?" })
            : button("Turn skills on for all agents", { op: "enable" }, { tone: "primary", confirm: "Give every agent the skill tool and the prompt section about plugins and skills? Every live chat re-reads its prompt once." }));
    } else if (opts.skill) {
        const has = opts.installed ?? Boolean(pack?.skills[opts.skill]);
        if (!has && repo) buttons.push(button(pack ? "Add this skill" : "Install this skill", { op: "install" }, { tone: "primary" }));
        if (has && pack) buttons.push(button("Remove this skill", { op: "remove" }, { tone: "danger", confirm: `Remove the skill ${opts.skill}?` }));
    } else {
        if (repo && !pack) buttons.push(button("Install all", { op: "install" }, { tone: "primary" }));
        if (repo && pack) buttons.push(button("Update / install the rest", { op: "install", all: "1" }));
        if (pack) buttons.push(button("Remove the pack", { op: "remove" }, { tone: "danger", confirm: `Remove the pack ${packName} with its ${Object.keys(pack.skills).length} skills?` }));
    }
    if (pack && !opts.skill && !opts.global) buttons.push(pack.model ? button("Stop agents picking it", { op: "deny" }) : button("Let agents pick it", { op: "allow" }));
    if (!buttons.length && !message) return "";
    const note = message ? `<div style="font-size:var(--w-text-small);color:var(--w-${tone === "danger" ? "danger" : "success"});overflow-wrap:anywhere">${esc(message)}</div>` : "";
    return `<div id="${id}" data-skills-actions style="display:flex;flex-direction:column;gap:var(--w-s1);min-width:0">${note}<div style="display:flex;flex-wrap:wrap;gap:var(--w-s2)">${buttons.join("")}</div></div>`;
}
