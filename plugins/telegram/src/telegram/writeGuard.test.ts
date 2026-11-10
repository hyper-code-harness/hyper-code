import { describe, expect, test } from "bun:test";
import send from "./send";
import sendFile from "./sendFile";
import createFolder from "./createFolder";
import leave from "./leave";
import deleteMessages from "./deleteMessages";
import sendPoll from "./sendPoll";
import folderAddChat from "./folderAddChat";
import addMember from "./addMember";

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
    test("sendPoll requires explicit confirmation before connecting", async () => {
        await expect(sendPoll(ctx, null, { chat: "me", question: "q?", options: ["a", "b"] })).rejects.toThrow("confirm: true");
    });
    test("sendPoll validates options and quiz settings before connecting", async () => {
        await expect(sendPoll(ctx, null, { chat: "me", question: "q?", options: ["a"], confirm: true })).rejects.toThrow("2–10");
        await expect(sendPoll(ctx, null, { chat: "me", question: "q?", options: ["a", "b"], correctOption: 2, confirm: true })).rejects.toThrow("out of range");
        await expect(sendPoll(ctx, null, { chat: "me", question: "q?", options: ["a", "b"], correctOption: 0, multiple: true, confirm: true })).rejects.toThrow("multiple-choice");
    });
    test("folderAddChat requires explicit confirmation before connecting", async () => {
        await expect(folderAddChat(ctx, null, { folder: "I", chat: "me" })).rejects.toThrow("confirm: true");
    });
    test("addMember requires explicit confirmation before connecting", async () => {
        await expect(addMember(ctx, null, { chat: "me", user: "x_bot" })).rejects.toThrow("confirm: true");
    });
});
