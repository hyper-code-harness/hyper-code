/** Finds PubMed papers related to a PMID using NCBI's official article-neighbor links, then returns normalized metadata. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** PubMed identifier of the seed article. */ pmid: string;
        /** Maximum related papers. @default 10 @minimum 1 @maximum 100 */ limit?: number;
    },
): Promise<types.medsearch.Paper[]> {
    const pmid = String(opts.pmid || "").replace(/^PMID:\s*/i, "").trim();
    if (!/^\d+$/.test(pmid)) throw new Error("medsearch.related: a numeric PMID is required");
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 100));
    const data = await ctx.fns.medsearch.pubmed({ endpoint: "elink", params: { id: pmid, cmd: "neighbor", linkname: "pubmed_pubmed" } });
    const links = data.linksets?.[0]?.linksetdbs?.[0]?.links ?? [];
    const ids = links.map(String).filter((id: string) => id !== pmid).slice(0, limit);
    if (!ids.length) return [];
    const details = await ctx.fns.medsearch.europepmc({ path: "search", params: { query: `EXT_ID:(${ids.join(" OR ")}) AND SRC:MED`, pageSize: String(ids.length), resultType: "core" } });
    const mapped = await Promise.all((details.resultList?.result ?? []).map((record: any) => ctx.fns.medsearch.mapPaper({ record })));
    const byId = new Map(mapped.map((p: types.medsearch.Paper) => [p.pmid, p]));
    return ids.map((id: string) => byId.get(id)).filter((p: types.medsearch.Paper | undefined): p is types.medsearch.Paper => Boolean(p));
}
