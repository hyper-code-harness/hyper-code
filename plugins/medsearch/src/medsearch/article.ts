/** Retrieves rich metadata, abstract, MeSH terms and identifiers for one PubMed or Europe PMC article. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** PubMed identifier. Supply one identifier field only. */ pmid?: string;
        /** PubMed Central identifier such as `PMC123456`. */ pmcid?: string;
        /** Digital object identifier. */ doi?: string;
    },
): Promise<types.medsearch.Paper> {
    const pmid = String(opts.pmid || "").replace(/^PMID:\s*/i, "").trim();
    const pmcid = String(opts.pmcid || "").replace(/^PMCID:\s*/i, "").trim();
    const doi = String(opts.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const supplied = [pmid, pmcid, doi].filter(Boolean);
    if (supplied.length !== 1) throw new Error("medsearch.article: supply exactly one of pmid, pmcid, or doi");
    const query = pmid ? `EXT_ID:${pmid} AND SRC:MED` : pmcid ? `PMCID:${pmcid}` : `DOI:\"${doi}\"`;
    const data = await ctx.fns.medsearch.europepmc({ path: "search", params: { query, pageSize: "1", resultType: "core" } });
    const record = data.resultList?.result?.[0];
    if (!record) throw new Error(`medsearch.article: article not found: ${supplied[0]}`);
    return ctx.fns.medsearch.mapPaper({ record });
}
