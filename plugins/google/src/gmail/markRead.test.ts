import { describe, expect, test } from "bun:test";
import markRead from "./markRead";
import markUnread from "./markUnread";

function context() {
    const calls: any[] = [];
    const ctx: any = { fns: { gmail: { modify: async (opts: any) => { calls.push(opts); return { modified: opts.id }; } } } };
    return { ctx, calls };
}

describe("Gmail read state", () => {
    test("markRead removes the UNREAD system label", async () => {
        const { ctx, calls } = context();
        expect(await markRead(ctx, null, { id: "msg-1", account: "person@example.com" })).toEqual({ id: "msg-1", read: true });
        expect(calls).toEqual([{ id: "msg-1", remove: ["UNREAD"], account: "person@example.com" }]);
    });

    test("markUnread adds the UNREAD system label", async () => {
        const { ctx, calls } = context();
        expect(await markUnread(ctx, null, { id: "msg-2" })).toEqual({ id: "msg-2", unread: true });
        expect(calls).toEqual([{ id: "msg-2", add: ["UNREAD"], account: undefined }]);
    });

    test("both operations require a message id", async () => {
        const { ctx } = context();
        await expect(markRead(ctx, null, { id: "" })).rejects.toThrow("id is required");
        await expect(markUnread(ctx, null, { id: " " })).rejects.toThrow("id is required");
    });
});
