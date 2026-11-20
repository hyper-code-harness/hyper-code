/** One indexed Agent Skill, as stored in `skill_docs` and returned by skills.list. */
export type Skill = {
    /** Full name: `<pack>:<name>`. */
    id: string;
    /** Short name; unique inside its pack. */
    name: string;
    /** Installed pack, or `local` for skills read in place from the shared folders (skills.roots). */
    pack: string;
    /** `pack` = installed by skills.install into ~/.hyper/skills; `root` = read in place from a shared folder. */
    source: "pack" | "root";
    /** Origin of the pack: local, official, listed or community. */
    trust: string;
    /** The pack is allowed to the model (skills.allowModel); false leaves /name only. */
    modelAllowed: boolean;
    description: string;
    /** Absolute folder of the skill; SKILL.md and its resources live here. */
    dir: string;
    /** The skill itself lets the model start it (no disable-model-invocation). */
    modelInvocable: boolean;
    /** A person may start it with /name. */
    userInvocable: boolean;
    argumentHint: string | null;
    /** Files next to SKILL.md, relative, sorted; capped at 300. */
    files: string[];
    diagnostics: string[];
    /** Length of the instructions in characters. */
    bodyChars: number;
    contentHash: string;
};
