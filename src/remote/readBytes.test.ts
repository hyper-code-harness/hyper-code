// remote.readBytes counts bytes while streaming: a remote side that sends more
// than the limit (a file that grew after the size check) is cut off. A fake
// `ssh` (HYPER_SSH_BIN) plays that remote side deterministically — no Docker needed.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";

test("the transfer stops at maxBytes even when the remote keeps sending", async () => {
    const bin = mkdtempSync(join(tmpdir(), "hyper-fake-ssh-"));
    // Ignores its arguments (the size check included) and streams forever.
    writeFileSync(join(bin, "ssh"), "#!/bin/sh\nexec yes 0123456789abcdef\n");
    chmodSync(join(bin, "ssh"), 0o755);
    try {
        const ctx: any = await mkTestCtx({ db: false, env: { HYPER_SSH_BIN: join(bin, "ssh"), HYPER_SSH_CONTROL_DIR: "/tmp/hyper-fake-cm" } });
        const t = Date.now();
        await expect(ctx.fns.remote.readBytes({ host: "anyhost", path: "f", maxBytes: 200_000 })).rejects.toThrow("more than 200000 bytes");
        expect(Date.now() - t).toBeLessThan(5_000);
    } finally {
        rmSync(bin, { recursive: true, force: true });
    }
});

test("a remote that sends less than the limit returns exactly those bytes", async () => {
    const bin = mkdtempSync(join(tmpdir(), "hyper-fake-ssh-"));
    writeFileSync(join(bin, "ssh"), "#!/bin/sh\nprintf '\\211PNG\\r\\n\\032\\n'\n");
    chmodSync(join(bin, "ssh"), 0o755);
    try {
        const ctx: any = await mkTestCtx({ db: false, env: { HYPER_SSH_BIN: join(bin, "ssh"), HYPER_SSH_CONTROL_DIR: "/tmp/hyper-fake-cm" } });
        expect(Array.from(await ctx.fns.remote.readBytes({ host: "anyhost", path: "f" }))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    } finally {
        rmSync(bin, { recursive: true, force: true });
    }
});
