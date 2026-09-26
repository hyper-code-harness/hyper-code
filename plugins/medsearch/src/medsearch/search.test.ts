import { describe, expect, test } from "bun:test";
import search from "./search";

function context(): any {
    const ctx: any = { state: {}, fns: { medsearch: {} } };
    ctx.fns.medsearch.pubmed = async ({ endpoint, params }: any) => {
        const mod = await import("./pubmed");
        return mod.default(ctx, null, { endpoint, params });
    };
    ctx.fns.medsearch.europepmc = async ({ path, params, format }: any) => {
        const mod = await import("./europepmc");
        return mod.default(ctx, null, { path, params, format });
    };
    ctx.fns.medsearch.mapPaper = async ({ record }: any) => {
        const mod = await import("./mapPaper");
        return mod.default(ctx, null, { record });
    };
    ctx.fns.medsearch.rank = async ({ query, papers, limit }: any) => {
        const mod = await import("./rank");
        return mod.default(ctx, null, { query, papers, limit });
    };
    ctx.fns.medsearch.jevRank = async ({ query, papers, limit, preselect, minScore }: any) => {
        const lexical = await ctx.fns.medsearch.rank({ query, papers, limit: Math.min(preselect ?? 40, papers.length) });
        return lexical.slice(0, limit).map((paper: any, index: number) => ({ ...paper, relevanceScore: 1 - index / 100 }));
    };
    return ctx;

}

describe("medsearch.search", () => {
    test("searches PubMed and returns normalized papers", async () => {
        const result = await search(context(), null, { query: "creatine cognition systematic review", limit: 2 });
        expect(result.source).toBe("pubmed");
        expect(result.total).toBeGreaterThan(0);
        expect(result.papers.length).toBeGreaterThan(0);
        expect(result.papers[0]?.pmid).toMatch(/^\d+$/);
        expect(result.papers[0]?.title.length).toBeGreaterThan(10);
    }, 20_000);

    test("searches Europe PMC with open-access filter", async () => {
        const result = await search(context(), null, { query: "hypertension exercise", source: "europepmc", openAccess: true, limit: 2 });
        expect(result.source).toBe("europepmc");
        expect(result.papers.length).toBeGreaterThan(0);
        expect(result.papers.every((paper: any) => paper.openAccess !== false)).toBe(true);
    }, 20_000);
});
