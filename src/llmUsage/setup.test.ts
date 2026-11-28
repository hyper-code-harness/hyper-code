import { describe, expect, test } from "bun:test";
import setup from "./setup";
import schema from "./schema.entry";

describe("explicit accounting schema provisioning", () => {
    test("requires the real owner guard before doing anything", async () => {
        let writes = 0;
        const denied = new Error("denied");
        const ctx: any = { fns: { llmUsage: { adminAccess: async () => { throw denied; } }, procs: { db: { exec: async () => { writes++; } } } } };
        await expect(setup(ctx, null, { confirmed: true })).rejects.toBe(denied);
        expect(writes).toBe(0);
    });
    test("does not create schema without exact explicit confirmation", async () => {
        let writes = 0;
        const ctx: any = { fns: { llmUsage: { adminAccess: async () => {} }, procs: { db: { exec: async () => { writes++; } } } } };
        await expect(setup(ctx, null, { confirmed: false })).rejects.toThrow("explicit owner confirmation");
        expect(writes).toBe(0);
    });
    test("uses the isolated fixture schema exactly and never enables collection", async () => {
        const statements: string[] = [];
        const ctx: any = { fns: { llmUsage: { adminAccess: async () => {} }, procs: { db: {
            transaction: async ({ fn }: any) => fn(), exec: async ({ sql }: any) => { statements.push(sql); },
        } } } };
        await expect(setup(ctx, null, { confirmed: true })).resolves.toEqual({ provisioned: true });
        const actual = statements.slice();
        statements.length = 0;
        await schema.up(ctx);
        expect(actual).toEqual(statements);
        expect(actual.join("\n")).not.toMatch(/(?:^|;)\s*(?:DROP|TRUNCATE|INSERT|DELETE|UPDATE)\b/i);
        expect(actual.join("\n")).not.toMatch(/prompt|headers|payload|api_key|authorization/i);
    });
});
