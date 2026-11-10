import { expect, test } from "bun:test";
import marker from "../../../marker/src/marker/status";
import mineru from "../../../mineru/src/mineru/status";

// On a machine without the engines (CI) status answers "not installed" instead of throwing ENOENT from spawn.
test("marker and mineru status report a missing engine instead of throwing", async () => {
    const saved = { HOME: process.env.HOME };
    process.env.HOME = "/nonexistent-home-for-status-test";
    try {
        const m = await mineru({} as any, null, {});
        expect(m.installed).toBe(false);
        expect(m.error).toBeTruthy();
        const k = await marker({} as any, null, {});
        expect(k.installed).toBe(false);
    } finally { process.env.HOME = saved.HOME; }
});
