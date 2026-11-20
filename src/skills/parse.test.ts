import { describe, expect, test } from "bun:test";
import parse from "./parse";

const run = (text: string, dirName = "sample") => parse({} as any, null, { text, dirName });

describe("skills.parse", () => {
    test("reads name, description and body; unknown fields are kept and ignored", async () => {
        const p = await run("---\nname: sample\ndescription: Does a thing. Use when asked.\nlicense: MIT\nmetadata:\n  a: b\n---\n\n# Sample\n\nSteps.\n");
        expect(p.ok).toBe(true);
        expect(p.name).toBe("sample");
        expect(p.description).toBe("Does a thing. Use when asked.");
        expect(p.body).toBe("# Sample\n\nSteps.");
        expect(p.frontmatter.license).toBe("MIT");
        expect(p.modelInvocable).toBe(true);
        expect(p.userInvocable).toBe(true);
        expect(p.diagnostics).toEqual([]);
    });

    test("an unquoted colon in the description is repaired instead of losing the skill", async () => {
        const p = await run("---\nname: sample\ndescription: Shared language for a factory: the tasks, the loop\n---\nBody\n");
        expect(p.ok).toBe(true);
        expect(p.description).toBe("Shared language for a factory: the tasks, the loop");
        expect(p.diagnostics.join(" ")).toContain("not valid YAML");
    });

    test("invocation policy: disable-model-invocation closes the model, user-invocable false closes /name", async () => {
        expect((await run("---\nname: sample\ndescription: d\ndisable-model-invocation: true\nargument-hint: \"[topic]\"\n---\nx")).modelInvocable).toBe(false);
        expect((await run("---\nname: sample\ndescription: d\ndisable-model-invocation: true\nargument-hint: \"[topic]\"\n---\nx")).argumentHint).toBe("[topic]");
        expect((await run("---\nname: sample\ndescription: d\nuser-invocable: false\n---\nx")).userInvocable).toBe(false);
        // a policy field that is not a boolean must not open model invocation by accident
        const odd = await run("---\nname: sample\ndescription: d\ndisable-model-invocation: maybe\n---\nx");
        expect(odd.modelInvocable).toBe(false);
        expect(odd.diagnostics.join(" ")).toContain("not a boolean");
    });

    test("name falls back to the folder; a mismatch is only a warning", async () => {
        expect((await run("---\ndescription: d\n---\nx", "my-skill")).name).toBe("my-skill");
        const bad = await run("---\nname: Bad_Name\ndescription: d\n---\nx", "my-skill");
        expect(bad.name).toBe("my-skill");
        const other = await run("---\nname: other\ndescription: d\n---\nx", "my-skill");
        expect(other.ok).toBe(true);
        expect(other.name).toBe("other");
        expect(other.diagnostics.join(" ")).toContain("differs from the folder name");
    });

    test("no description: the first line of the body is used; nothing at all is not a skill", async () => {
        const p = await run("---\nname: sample\n---\n# Does the thing\n\nMore.");
        expect(p.ok).toBe(true);
        expect(p.description).toBe("Does the thing");
        const empty = await run("---\nname: sample\n---\n");
        expect(empty.ok).toBe(false);
        expect(empty.diagnostics.at(-1)).toBe("no description");
    });

    test("YAML that cannot be repaired is reported, not thrown", async () => {
        const p = await run("---\nname: [unclosed\ndescription: d\n---\nx");
        expect(p.ok).toBe(false);
        expect(p.diagnostics.at(-1)).toBe("frontmatter is not valid YAML");
    });

    test("harness-only fields and command injections are named in diagnostics", async () => {
        const p = await run("---\nname: sample\ndescription: d\nmodel: opus\nallowed-tools: Bash(git:*)\n---\nRun !`git status` first.");
        expect(p.ok).toBe(true);
        expect(p.diagnostics.join(" | ")).toContain("not applied here: model");
        expect(p.diagnostics.join(" | ")).toContain("allowed-tools grants nothing here");
        expect(p.diagnostics.join(" | ")).toContain("!`command` injections");
    });
});
