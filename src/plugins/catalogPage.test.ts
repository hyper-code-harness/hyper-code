import { test, expect } from "bun:test";
import catalogPage from "./catalogPage";
import listingPage from "./listingPage";
import frame from "../rpc/frame";

const catalog = { host: null, urls: [], errors: [], plugins: [{ name: "chart", label: "Chart", latest: "1.0.0", requires: [] }] };
const ctx: any = { fns: { rpc: { frame: (o: any) => frame(ctx, null, o) }, w: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) }, plugins: { catalog: async () => catalog } } };

test("catalog page frames the embedded catalog and carries the search", async () => {
    expect(await catalogPage(ctx, null, {})).toContain('src="/plugins/listing?embed=1"');
    expect(await catalogPage(ctx, null, { q: " sql & charts " })).toContain('src="/plugins/listing?embed=1&amp;q=sql%20%26%20charts"');
});

test("embedded catalog keeps embed mode on its search and action forms", async () => {
    const plain = await listingPage(ctx, null, {});
    expect(plain).not.toContain("embed");
    const framed = await listingPage(ctx, null, { embed: true });
    expect(framed).toContain('<input type="hidden" name="embed" value="1">');
    const change: any = { operation: "install", name: "chart", status: "preview", digest: "d", newPackages: [], added: [], changed: [], removed: [] };
    const review = await listingPage(ctx, null, { change, embed: true });
    expect(review).toContain('action="/plugins/listing?embed=1"');
    expect(review).toContain('href="/plugins/listing?embed=1">Back to catalog');
    expect(review).not.toMatch(/"\/plugins\/listing"/);
});
