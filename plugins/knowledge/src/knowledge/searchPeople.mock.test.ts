import { expect, test } from "bun:test";
import source from "./$search_people";

test("knowledge search source: @ prefix, rows link to the entity page, short queries skip the database", async () => {
    let calls = 0;
    const ctx: any = { fns: { knowledge: { find: async (o: any) => { calls++; return [{ id: "Person/anna-k", type: "Person", title: "Anna K", summary: "CTO", snippet: "", score: 1 }].slice(0, o.limit); } } } };
    expect(source.prefix).toBe("@");
    expect(await source.search(ctx, null, { q: "a", limit: 5 })).toEqual([]);
    expect(calls).toBe(0);
    expect(await source.search(ctx, null, { q: "anna", limit: 5 })).toEqual([{ id: "knowledge:Person/anna-k", label: "Anna K", href: "/knowledge/Person/anna-k", icon: "ph-user", hint: "Person", detail: "CTO" }]);
});
