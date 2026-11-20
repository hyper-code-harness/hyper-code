/** One SKILL.md read by skills.parse: what the frontmatter says, the instructions, and who may start the skill. */
export type Parsed = {
    /** False when the file cannot be used as a skill (unreadable YAML, no description); diagnostics say why. */
    ok: boolean;
    /** Skill name: the frontmatter name when it is a valid kebab-case name, otherwise the folder name. */
    name: string;
    /** What the skill does and when to use it (description plus when_to_use), at most 1536 characters. */
    description: string;
    /** Markdown instructions after the frontmatter. */
    body: string;
    /** Every frontmatter field as written. */
    frontmatter: Record<string, unknown>;
    /** The model may start the skill by itself; false for disable-model-invocation and for a policy field that is not a boolean. */
    modelInvocable: boolean;
    /** A person may start the skill with /name; false only for user-invocable: false. */
    userInvocable: boolean;
    /** Hint for the arguments after /name, when the skill gives one. */
    argumentHint: string | null;
    /** Warnings and the reason for ok:false, in reading order. */
    diagnostics: string[];
    /** SHA-256 of the file text, hex. */
    hash: string;
};
