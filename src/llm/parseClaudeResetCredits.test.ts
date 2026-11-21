import { describe, expect, test } from "bun:test";
import parse from "./parseClaudeResetCredits";

const now = Date.parse("2026-11-21T12:00:00Z");
const grant = (patch: Record<string, unknown> = {}) => ({ id: "weekly", label: "Weekly reset", type: "weekly", resets_total: 3, resets_left: 2, starts_at: "2026-11-10T00:00:00Z", ends_at: "2026-12-10T22:00:00Z", usable_now: true, paused: false, clears: ["seven_day"], ...patch });
const read = (status: unknown) => parse({} as Context, null, { status, now });

describe("Claude reset availability is read-only and explicit", () => {
    test("counts uses, not rows, and accepts actual CLI payload without claimable", async () => {
        const result = await read({ eligible: true, grants: [grant(), grant({ id: "fable", type: "full", resets_left: 1, claimable: false })] });
        expect(result).toMatchObject({ availableCount: 3, checkedAt: now, credits: [
            { id: "weekly", remainingCount: 2, usableNow: true, resetType: "weekly", expiresAt: Date.parse("2026-12-10T22:00:00Z") },
            { id: "fable", remainingCount: 1, usableNow: false, status: "restricted" },
        ] });
    });
    test("zero is only a successful eligible empty or spent response", async () => {
        expect(await read({ eligible: true, grants: [] })).toMatchObject({ availableCount: 0 });
        expect(await read({ eligible: true, grants: [grant({ resets_left: 0 })] })).toMatchObject({ availableCount: 0 });
        expect(await read({ eligible: false, ineligible_reason: "surface", grants: [] })).toMatchObject({ availableCount: null, unavailableReason: "surface" });
        expect(await read(null)).toMatchObject({ availableCount: null, unavailableReason: "unavailable" });
        expect(await read({ eligible: false, grants: [] })).toMatchObject({ availableCount: null });
    });
    test("expired and not-yet-started grants do not inflate availability", async () => {
        const result = await read({ eligible: true, grants: [grant({ ends_at: new Date(now).toISOString() }), grant({ id: "future", starts_at: new Date(now + 1).toISOString() }), grant({ id: "active", resets_left: 1 })] });
        expect(result.availableCount).toBe(1);
        expect(result.credits?.map(c => c.id)).toEqual(["active"]);
    });
    test("paused grants remain owned but are labelled restricted", async () => {
        expect(await read({ eligible: true, grants: [grant({ paused: true })] })).toMatchObject({ availableCount: 2, credits: [{ usableNow: false, status: "restricted" }] });
    });
    for (const patch of [{ resets_left: -1 }, { resets_left: "2" }, { resets_left: 4 }, { ends_at: "invalid" }, { id: "" }, { resets_total: 10001 }, { starts_at: "2027-01-01" }]) {
        test("malformed grant produces unknown rather than a partial misleading count: " + JSON.stringify(patch), async () => {
            expect(await read({ eligible: true, grants: [grant(patch)] })).toMatchObject({ availableCount: null, unavailableReason: "invalid-response" });
        });
    }
    test("duplicate IDs and oversized batches fail closed", async () => {
        expect(await read({ eligible: true, grants: [grant(), grant()] })).toMatchObject({ availableCount: null });
        expect(await read({ eligible: true, grants: Array.from({ length: 101 }, (_, i) => grant({ id: String(i) })) })).toMatchObject({ availableCount: null });
    });
});
