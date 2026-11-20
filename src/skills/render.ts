/**
 * Renders one skill as the `<skill_content>` block a model reads: instructions, the skill folder and its files
 *
 * Use wherever a skill enters a conversation — the `skill` tool and /name — so both look the same and the model can
 * tell a loaded skill from other text. Reads SKILL.md from disk at call time (an edited skill is seen at once), drops
 * the frontmatter, replaces `${CLAUDE_SKILL_DIR}` with the folder and `$ARGUMENTS` with `args`, and lists up to 30
 * files that sit next to SKILL.md without reading them. Instructions longer than `maxChars` are cut with a note that
 * says how to read on.
 * @param opts.skill Skill row from skills.list or skills.resolve.
 * @param opts.args Text the person typed after /name; replaces $ARGUMENTS in the instructions.
 * @param opts.offset Character offset into the instructions to start from. @default 0 @minimum 0
 * @param opts.maxChars Longest slice of instructions returned. @default 36000 @minimum 1000 @maximum 100000
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Skill row from skills.list or skills.resolve. */
    skill: types.skills.Skill;
    /** Text the person typed after /name; replaces $ARGUMENTS in the instructions. */
    args?: string;
    /** Character offset into the instructions to start from. @default 0 @minimum 0 */
    offset?: number;
    /** Longest slice of instructions returned. @default 36000 @minimum 1000 @maximum 100000 */
    maxChars?: number;
}): Promise<{ text: string; hash: string; bodyChars: number; truncated: boolean }> {
    const { join } = await import("node:path");
    const skill = opts.skill;
    const parsed = await ctx.fns.skills.parse({ path: join(skill.dir, "SKILL.md"), dirName: skill.name });
    if (!parsed.ok) throw new Error(`skill ${skill.id}: ${parsed.diagnostics.at(-1) ?? "SKILL.md cannot be read"}`);
    let body = parsed.body.replaceAll("${CLAUDE_SKILL_DIR}", skill.dir);
    if (opts.args !== undefined) body = body.replaceAll("$ARGUMENTS", opts.args);
    const max = Math.max(1000, Math.min(100_000, Math.floor(Number(opts.maxChars ?? 36_000)) || 36_000));
    const offset = Math.max(0, Math.floor(Number(opts.offset ?? 0)) || 0);
    const slice = body.slice(offset, offset + max);
    const truncated = offset + max < body.length;
    const files = skill.files.slice(0, 30);
    const lines = [
        `<skill_content name="${skill.id}">`,
        "<skill_instructions>",
        slice,
        ...(truncated ? [`[instructions continue: ${body.length - offset - max} more characters — call skill with name "${skill.id}" and offset ${offset + max}]`] : []),
        "</skill_instructions>",
        `<skill_resources dir="${skill.dir}">`,
        ...files,
        ...(skill.files.length > files.length ? [`… and ${skill.files.length - files.length} more files`] : []),
        files.length
            ? `Relative paths in this skill are relative to that directory. Read a listed file with skill({ name: "${skill.id}", file: "<path>" }); run its scripts with bash using the absolute path. Do not write into that directory.`
            : "This skill has no other files.",
        "</skill_resources>",
        "<skill_reading>",
        'This skill was written for another harness. Read its words like this: "call the Skill tool with X" is skill({ name: "X" }) — X is another skill, not a file; a sub-agent, background agent or fresh context is ctx.fns.agent.delegate; "ask the user" is plain chat, or ctx.fns.input.request for a fixed choice; a todo list or issue tracker is ctx.fns.session.plan or the tasks plugin; $TMPDIR and scratch files are ctx.fns.workspace.tmp; handoff notes are memory.write. Packages a script needs go into an isolated environment (uv run --with, or one under your tmp folder), never a global install.',
        "</skill_reading>",
        "</skill_content>",
    ];
    return { text: lines.join("\n"), hash: parsed.hash, bodyChars: body.length, truncated };
}
