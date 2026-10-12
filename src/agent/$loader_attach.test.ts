import { describe, expect, test } from "bun:test";
import loadAttachments from "./$loader_attach";

describe("$attach loader", () => {
    test("merges producers collected from separate mounted modules", async () => {
        const ctx: any = { state: {} };
        await loadAttachments(ctx, null, { entries: [{ name: "one", rel: "one/$attach_one.ts", fn: { start() {} } }] });
        await loadAttachments(ctx, null, { entries: [{ name: "two", rel: "two/$attach_two.ts", fn: { start() {} } }] });
        expect(Object.keys(ctx.state.attachments.declarations).sort()).toEqual(["one", "two"]);
    });
});
