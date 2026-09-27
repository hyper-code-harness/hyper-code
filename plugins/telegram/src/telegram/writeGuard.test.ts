import { describe, expect, test } from "bun:test";
import send from "./send";
import sendFile from "./sendFile";
import createFolder from "./createFolder";
import leave from "./leave";
import deleteMessages from "./deleteMessages";

const ctx: any = {};

describe("Telegram write guards", () => {
    test("send requires explicit confirmation before connecting", async () => {
        await expect(send(ctx, null, { chat: "me", text: "hello" })).rejects.toThrow("confirm: true");
    });
    test("sendFile requires explicit confirmation before connecting", async () => {
        await expect(sendFile(ctx, null, { chat: "me", path: "/tmp/x" })).rejects.toThrow("confirm: true");
    });
    test("createFolder requires explicit confirmation before connecting", async () => {
        await expect(createFolder(ctx, null, { title: "x", chats: ["me"] })).rejects.toThrow("confirm: true");
    });
    test("leave requires explicit confirmation before connecting", async () => {
        await expect(leave(ctx, null, { chat: "me" })).rejects.toThrow("confirm: true");
    });
    test("deleteMessages requires explicit confirmation before connecting", async () => {
        await expect(deleteMessages(ctx, null, { chat: "me", ids: [1] })).rejects.toThrow("confirm: true");
    });
    test("deleteMessages rejects an empty id list even when confirmed", async () => {
        await expect(deleteMessages(ctx, null, { chat: "me", ids: [], confirm: true })).rejects.toThrow("at least one message id");
    });
    test("deleteMessages rejects non-positive ids even when confirmed", async () => {
        await expect(deleteMessages(ctx, null, { chat: "me", ids: [0], confirm: true })).rejects.toThrow("positive integers");
    });
});
