import { describe, expect, test } from "bun:test";
import home from "./render";

describe("home", () => {
    test("renders first-run checklist and links", async () => {
        const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => text } }, w: { escape: ({ text }: any) => text }, session: { list: async () => [] }, llm: { listAccounts: async () => [] } } };
        const page = await home(ctx, null, {});
        expect(page.main).toContain("Connect an LLM");
        expect(page.main).toContain('href="/llms"');
        expect(page.main).toContain('href="/agent/new"');
        expect(page.main).toContain('href="/files"');
    });

    test("renders recent and running agents with resume link", async () => {
        const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => text } }, w: { escape: ({ text }: any) => text }, session: { list: async () => [{ id: "aa", title: "Alpha", runState: "running", unread: 2, workspaceDir: "/tmp/work" }] }, llm: { listAccounts: async () => [{ available: true }] } } };
        const page = await home(ctx, null, {});
        expect(page.main).toContain("Running now");
        expect(page.main).toContain("Alpha");
        expect(page.main).toContain('href="/agent/aa"');
        expect(page.main).toContain("Resume latest");
    });
});
