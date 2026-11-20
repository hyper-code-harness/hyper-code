const PAGE = 36_000;

/**
 * Finds Agent Skills by what they are for, loads one into the conversation, or reads a file of a loaded skill — the implementation of the `skill` tool
 *
 * Nothing about the installed skills is put into an agent's context in advance: with `query` this returns the
 * matching skills (name and description) so an agent can pick one, and with `name` the full instructions come back
 * as a `<skill_content>` block to follow. With `file`, returns that file from the skill's folder instead (a reference, a
 * template, a script to inspect), paged by `offset`. A skill already loaded in this conversation is not sent twice:
 * the answer says so, and `file: "SKILL.md"` reads it again when it is really gone. The model may load a skill whose
 * author allows it and whose pack is allowed to the model; a skill of a pack the person already started with /name
 * is allowed too, so skills that call each other keep working. Every load is recorded in `skill_usage` (skill, agent,
 * who started it — never message text). Problems come back as an error result, not an exception.
 * @param opts.name Skill to load: short name (`tdd`) or full (`pack:tdd`), as a search returned it or the person said it.
 * @param opts.query What a skill should help with, to search instead of loading.
 * @param opts.file Relative path of a file inside the skill's folder to read instead of the instructions.
 * @param opts.offset Character offset to continue a long text from. @default 0 @minimum 0
 * @param opts.via Who starts the skill: the model through the tool, or a person through /name. @default "model"
 * @param opts.args Text typed after /name; replaces $ARGUMENTS in the instructions.
 * @param opts.messageIdx With via "user": idx of the person's own chat message that starts with /name — the proof that a person asked.
 * @param opts.agentId Agent the skill is loaded for; defaults to the calling agent.
 * @param opts.agent Live agent object, when the caller holds it (agent.run); keeps its scratchpad in step.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Skill to load: short name (`tdd`) or full (`pack:tdd`), as a search returned it or the person said it. */
    name?: string;
    /** What a skill should help with, to search instead of loading. */
    query?: string;
    /** Relative path of a file inside the skill's folder to read instead of the instructions. */
    file?: string;
    /** Character offset to continue a long text from. @default 0 @minimum 0 */
    offset?: number;
    /** Who starts the skill: the model through the tool, or a person through /name. @default "model" */
    via?: "model" | "user";
    /** Text typed after /name; replaces $ARGUMENTS in the instructions. */
    args?: string;
    /** With via "user": idx of the person's own chat message that starts with /name — the proof that a person asked. */
    messageIdx?: number;
    /** Agent the skill is loaded for; defaults to the calling agent. */
    agentId?: string;
    /** Live agent object, when the caller holds it (agent.run); keeps its scratchpad in step. */
    agent?: types.agent.Agent;
}): Promise<{ output: string; isError: boolean; skill?: string; loaded?: boolean }> {
    const fail = (output: string) => ({ output, isError: true });
    const via = opts.via === "user" ? "user" : "model";
    const agentId = opts.agent?.id ?? opts.agentId ?? session?.agent?.id ?? session?.agentId ?? null;
    const live: any = !agentId ? null : opts.agent ?? (session?.agent?.id === agentId ? session.agent : (ctx.state as any).agent?.[agentId] ?? null);
    const state: { loaded?: Record<string, { hash: string; revision: number | null; via: string }> } = live?.scratchpad?.skills ?? {};
    const loaded = state.loaded ?? {};
    const activePacks = [...new Set(Object.keys(loaded).map(id => id.split(":")[0]!))];

    const one = (text: string) => text.replace(/\s+/g, " ").trim();
    type Hit = { id: string; name: string; description: string; byModel: boolean; byUser: boolean };
    const line = (hit: Hit) => `- ${hit.id}: ${one(hit.description).slice(0, 220)}${hit.byModel ? "" : hit.byUser ? ` [you cannot load it; the person starts it with /${hit.name}]` : " [not available]"}`;
    // What the agent can load is listed first and apart: a small model otherwise takes the top line, whatever it says.
    const listing = (hits: Hit[]) => {
        const mine = hits.filter(hit => hit.byModel), theirs = hits.filter(hit => !hit.byModel);
        return [
            ...(mine.length ? ["You can load these with skill({ name }):", ...mine.map(line)] : ["None of the matches can be loaded by you."]),
            ...(theirs.length ? [mine.length
                ? "Only the person can start these, by typing /name — mention one only when none of the skills above fits:"
                : "Only the person can start these, by typing /name in the chat — tell them, do not load or describe them:", ...theirs.slice(0, mine.length ? 3 : 8).map(line)] : []),
        ].join("\n");
    };
    const outside = "ctx.fns.skills.hubSearch({ query }) looks in public collections, and ctx.fns.skills.propose({ repo, select, why }) offers one to the person — you cannot install by yourself.";
    const query = String(opts.query ?? "").trim();
    if (query && !opts.name) {
        const hits = await ctx.fns.skills.search({ query, limit: 8 });
        if (!hits.length) return { output: `No installed skill matches "${query}". ${outside}`, isError: false };
        const next = hits.some(hit => hit.byModel) ? "Next: if one of the skills you can load fits, load it with skill({ name }) before you answer — a description is not the procedure. " : "";
        return { output: `<skill_search query="${query.replace(/"/g, "'")}">\n${listing(hits)}\n</skill_search>\n${next}Nothing here fits the task? ${outside}`, isError: false };
    }
    if (!opts.name) return fail("Give `query` to search for a skill, or `name` to load one.");

    const found = await ctx.fns.skills.resolve({ name: opts.name, preferPacks: activePacks });
    if (!found.skill) {
        if (found.candidates.length) return fail(`Several skills are called "${opts.name}": ${found.candidates.join(", ")}. Use one of these full names.`);
        const near = await ctx.fns.skills.search({ query: opts.name.replace(/[-:_]+/g, " "), limit: 4 }).catch(() => []);
        return fail(`No skill is called "${opts.name}".` + (near.length ? ` Closest:\n${listing(near)}` : ` Search with skill({ query }). ${outside}`));
    }
    const skill = found.skill;
    const offset = Math.max(0, Math.floor(Number(opts.offset ?? 0)) || 0);
    if (via === "user") {
        // "The person started it" is a claim: it holds only for a human message of this chat that really begins with /name.
        const row = agentId == null || opts.messageIdx == null ? null : ((await ctx.fns.procs.db.select({
            sql: "SELECT content, author, message_type FROM messages WHERE agent_id = ? AND idx = ? AND role = 'user' AND excluded_from_cursor = 0",
            params: [agentId, Math.floor(Number(opts.messageIdx))],
        })) as any[])[0];
        const typed = /^\/([a-z0-9:-]+)(?=\s|$)/.exec(String(row?.content ?? "").trimStart())?.[1];
        if (!row || (row.message_type != null && row.message_type !== "message") || String(row.author ?? "").startsWith("agent:") || (typed !== skill.name && typed !== skill.id))
            return fail(`Skill ${skill.id} can be started this way only by the person typing /${skill.name} in the chat.`);
    }

    if (opts.file) {
        if (via === "model" && !loaded[skill.id]) return fail(`Load the skill first: skill({ name: "${skill.id}" }).`);
        const fs = await import("node:fs/promises");
        const { resolve, sep } = await import("node:path");
        const root = await fs.realpath(skill.dir).catch(() => skill.dir);
        const target = await fs.realpath(resolve(root, opts.file)).catch(() => null);
        if (!target || (target !== root && !target.startsWith(root + sep))) {
            // The usual cause: the skill said "call the Skill tool with X" and X went into `file`. X is another skill.
            const other = await ctx.fns.skills.resolve({ name: opts.file, preferPacks: [skill.pack, ...activePacks] });
            return fail(`"${opts.file}" is not a file of skill ${skill.id}.` + (other.skill ? ` It is the name of another skill — load it with skill({ name: "${other.skill.id}" }).` : ""));
        }
        const stat = await fs.stat(target);
        if (!stat.isFile()) return fail(`"${opts.file}" is not a file.`);
        if (stat.size > 2_000_000) return fail(`"${opts.file}" is ${stat.size} bytes — too large to read here; use bash on ${target}.`);
        const content = await fs.readFile(target);
        if (content.includes(0)) return fail(`"${opts.file}" is a binary file; use it from bash at ${target}.`);
        const text = content.toString("utf8");
        const slice = text.slice(offset, offset + PAGE);
        const more = text.length - offset - PAGE;
        return { output: `<skill_file skill="${skill.id}" path="${opts.file}">\n${slice}\n${more > 0 ? `[continues: ${more} more characters — repeat with offset ${offset + PAGE}]\n` : ""}</skill_file>`, isError: false, skill: skill.id };
    }

    if (via === "model") {
        if (!skill.modelInvocable) return fail(`Skill ${skill.id} was NOT loaded: its author reserved it for the person. Tell them they can start it by typing /${skill.name} in the chat. Do not read its files another way and do not describe what it says.`);
        if (!skill.modelAllowed && !activePacks.includes(skill.pack)) return fail(`Skill ${skill.id} is installed but was NOT loaded: the person has not allowed agents to pick skills of pack ${skill.pack}. Tell them: they can start it by typing /${skill.name} in the chat, or press "Let agents pick it" for ${skill.pack} on the Skills page (/rpc/skills.page). You cannot allow it yourself. Do not read its files another way and do not describe what it says.`);
    } else if (!skill.userInvocable) return fail(`Skill ${skill.id} is not meant to be started with /${skill.name}.`);

    let rendered: Awaited<ReturnType<typeof ctx.fns.skills.render>>;
    try { rendered = await ctx.fns.skills.render({ skill, args: opts.args, offset, maxChars: PAGE }); }
    catch (error: any) { return fail(String(error?.message ?? error)); }

    const revision = Number(live?.sleepContext?.activeRevision ?? 0) || null;
    const before = loaded[skill.id];
    if (via === "model" && offset === 0 && before && before.hash === rendered.hash && before.revision === revision)
        return { output: `Skill ${skill.id} is already loaded in this conversation — follow the <skill_content name="${skill.id}"> block above. If it is no longer visible, read it again with skill({ name: "${skill.id}", file: "SKILL.md" }).`, isError: false, skill: skill.id, loaded: false };

    if (offset === 0) {
        if (agentId) {
            const entry = { hash: rendered.hash, revision, via };
            if (live) { live.scratchpad ??= {}; live.scratchpad.skills = { ...(live.scratchpad.skills ?? {}), loaded: { ...loaded, [skill.id]: entry } }; }
            await ctx.fns.session.mutateScratchpad({ id: agentId, mutate: (scratchpad: Record<string, any>) => { scratchpad.skills = { ...(scratchpad.skills ?? {}), loaded: { ...(scratchpad.skills?.loaded ?? {}), [skill.id]: entry } }; } })
                .catch((error: any) => ctx.fns.procs.log.warn({ event: "skills.use.scratchpad-failed", msg: String(error?.message ?? error), agentId }));
        }
        await ctx.fns.procs.db.run({ sql: "INSERT INTO skill_usage (ts, skill_id, agent_id, via, content_hash) VALUES (?,?,?,?,?)", params: [Date.now(), skill.id, agentId, via, rendered.hash] })
            .catch((error: any) => ctx.fns.procs.log.warn({ event: "skills.use.usage-failed", msg: String(error?.message ?? error), skill: skill.id }));
    }
    return { output: rendered.text, isError: false, skill: skill.id, loaded: true };
}
