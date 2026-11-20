const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Fields of other harnesses that change how a skill RUNS there and have no effect here; said once in diagnostics.
const IGNORED = ["model", "effort", "hooks", "context", "agent", "background", "paths", "shell", "disallowed-tools"];

/**
 * Parses one SKILL.md of a standard Agent Skill leniently: frontmatter, instructions, invocation policy and diagnostics
 *
 * Use wherever a skill file is read — indexing, install preview, activation. Follows the agentskills.io client guide:
 * warn and load when possible, skip only when the YAML cannot be read at all or there is no description. Unknown
 * frontmatter fields are kept and ignored. A description with an unquoted `key: value` colon is repaired and parsed
 * again. Understands the Claude Code extensions `disable-model-invocation`, `user-invocable`, `argument-hint` and
 * `when_to_use`, and Codex's `agents/openai.yaml` (`policy.allow_implicit_invocation: false`) next to the file. A
 * policy field that is present but not a boolean closes model invocation. Never throws for a bad file: `ok` is false
 * and `diagnostics` says why.
 * @param opts.path Absolute path of the SKILL.md; read when text is not given, and used to find agents/openai.yaml next to it.
 * @param opts.text File text when the caller already has it.
 * @param opts.dirName Folder name, used as the skill name when the frontmatter has none or an invalid one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path of the SKILL.md; read when text is not given, and used to find agents/openai.yaml next to it. */
    path?: string;
    /** File text when the caller already has it. */
    text?: string;
    /** Folder name, used as the skill name when the frontmatter has none or an invalid one. */
    dirName?: string;
}): Promise<types.skills.Parsed> {
    const diagnostics: string[] = [];
    const fallback = String(opts.dirName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    const bad = (reason: string, hash = ""): types.skills.Parsed => ({
        ok: false, name: fallback, description: "", body: "", frontmatter: {}, modelInvocable: false, userInvocable: false,
        argumentHint: null, diagnostics: [...diagnostics, reason], hash,
    });
    let raw: string;
    try { raw = opts.text ?? await Bun.file(String(opts.path)).text(); }
    catch { return bad("SKILL.md is not readable"); }
    const hash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

    let data: Record<string, unknown> = {};
    let body = text;
    const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
    if (!m) diagnostics.push("no YAML frontmatter");
    else {
        body = m[2] ?? "";
        const yaml = m[1] ?? "";
        let parsed: unknown;
        try { parsed = Bun.YAML.parse(yaml); }
        catch {
            try { parsed = Bun.YAML.parse(repair(yaml)); diagnostics.push("frontmatter is not valid YAML; unquoted values with a colon were quoted"); }
            catch { return bad("frontmatter is not valid YAML", hash); }
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
        else if (parsed != null) return bad("frontmatter is not a YAML mapping", hash);
    }
    body = body.trim();

    let name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) name = fallback;
    else if (name.length > 64 || !NAME.test(name)) { diagnostics.push(`name "${name.slice(0, 80)}" is not a valid skill name; the folder name is used`); name = fallback; }
    else if (fallback && name !== fallback) diagnostics.push(`name "${name}" differs from the folder name "${fallback}"`);
    if (!name || !NAME.test(name)) return bad("no usable skill name", hash);

    let description = [data.description, data.when_to_use].filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(v => v.trim()).join(" ");
    if (!description) {
        description = (body.split("\n").map(line => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "").slice(0, 300);
        if (!description) return bad("no description", hash);
        diagnostics.push("no description in the frontmatter; the first line of the instructions is used");
    }
    if (description.length > 1536) { diagnostics.push("description is longer than 1536 characters and was cut"); description = description.slice(0, 1536); }

    let modelInvocable = true;
    const disable = data["disable-model-invocation"];
    if (disable === true) modelInvocable = false;
    else if (disable !== undefined && disable !== false) { modelInvocable = false; diagnostics.push("disable-model-invocation is not a boolean; model invocation is closed"); }
    let userInvocable = true;
    const invocable = data["user-invocable"];
    if (invocable === false) userInvocable = false;
    else if (invocable !== undefined && invocable !== true) diagnostics.push("user-invocable is not a boolean and was ignored");

    // Codex keeps its policy outside SKILL.md, in agents/openai.yaml next to it.
    if (opts.path) {
        const { dirname, join } = await import("node:path");
        const openai = await Bun.file(join(dirname(opts.path), "agents", "openai.yaml")).text().catch(() => null);
        if (openai) {
            try { if ((Bun.YAML.parse(openai) as any)?.policy?.allow_implicit_invocation === false) modelInvocable = false; }
            catch { diagnostics.push("agents/openai.yaml is not valid YAML and was ignored"); }
        }
    }

    const ignored = IGNORED.filter(key => data[key] !== undefined);
    if (ignored.length) diagnostics.push(`not applied here: ${ignored.join(", ")}`);
    if (data["allowed-tools"] !== undefined) diagnostics.push("allowed-tools grants nothing here");
    if (/!`[^`\n]+`/.test(body)) diagnostics.push("contains !`command` injections, which are not executed here");

    return {
        ok: true, name, description, body, frontmatter: data, modelInvocable, userInvocable,
        argumentHint: typeof data["argument-hint"] === "string" && data["argument-hint"].trim() ? data["argument-hint"].trim().slice(0, 200) : null,
        diagnostics, hash,
    };
}

// `description: Use when: the user asks` is not YAML; other harnesses accept it, so quote such scalars and retry.
function repair(yaml: string): string {
    return yaml.split("\n").map(line => {
        const k = /^([A-Za-z_][\w-]*):[ \t]+(.+)$/.exec(line);
        if (!k) return line;
        const value = k[2]!.trim();
        if (/^["'>|\[{]/.test(value)) return line;
        return `${k[1]}: ${JSON.stringify(value)}`;
    }).join("\n");
}
