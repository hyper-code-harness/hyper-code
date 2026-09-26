/** Retrieves open-access full-text XML from Europe PMC for a PubMed Central article. Use only after article metadata confirms a PMCID. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** PubMed Central identifier such as `PMC123456`; a PMID is also accepted and resolved first. */ id: string;
        /** Maximum XML characters returned. @default 200000 @minimum 1000 @maximum 1000000 */ maxChars?: number;
    },
): Promise<{ pmcid: string; xml: string; truncated: boolean; url: string }> {
    let id = String(opts.id || "").trim();
    if (!id) throw new Error("medsearch.fullText: id is required");
    let pmcid = /^PMC\d+$/i.test(id) ? id.toUpperCase() : "";
    if (!pmcid && /^\d+$/.test(id)) pmcid = (await ctx.fns.medsearch.article({ pmid: id })).pmcid || "";
    if (!pmcid) throw new Error(`medsearch.fullText: no open PubMed Central identifier for ${id}`);
    const xml = String(await ctx.fns.medsearch.europepmc({ path: `${pmcid}/fullTextXML`, format: "xml" }));
    const maxChars = Math.max(1000, Math.min(opts.maxChars ?? 200000, 1000000));
    return { pmcid, xml: xml.slice(0, maxChars), truncated: xml.length > maxChars, url: `https://europepmc.org/articles/${pmcid}` };
}
