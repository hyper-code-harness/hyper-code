/** Normalizes one Europe PMC result into MedSearch's stable paper shape. */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Europe PMC core-result metadata to normalize into the common MedSearch paper model. */
        record: types.medsearch.EuropePmcRecord;
    },
): Promise<types.medsearch.Paper> {
    const r = opts.record;
    const pmid = r.pmid ? String(r.pmid) : null;
    const pmcid = r.pmcid ? String(r.pmcid) : null;
    const id = pmid || pmcid || String(r.id || r.doi || "");
    const authorList = Array.isArray(r.authorList?.author)
        ? r.authorList.author.map((a) => a.fullName || [a.firstName, a.lastName].filter(Boolean).join(" ")).filter(Boolean)
        : String(r.authorString || "").split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    const meshTerms = Array.isArray(r.meshHeadingList?.meshHeading)
        ? r.meshHeadingList.meshHeading.map((m) => m.descriptorName || m.meshHeading).filter(Boolean)
        : [];
    const publicationTypes = Array.isArray(r.pubTypeList?.pubType) ? r.pubTypeList.pubType.map(String) : [];
    return {
        source: "europepmc", id, pmid, pmcid, doi: r.doi ? String(r.doi) : null,
        title: String(r.title || ""), abstract: String(r.abstractText || ""), authors: authorList,
        journal: String(r.journalTitle || r.journalInfo?.journal?.title || ""),
        published: String(r.firstPublicationDate || r.electronicPublicationDate || r.journalInfo?.printPublicationDate || r.pubYear || ""),
        publicationTypes, meshTerms,
        citedByCount: Number.isFinite(Number(r.citedByCount)) ? Number(r.citedByCount) : null,
        openAccess: r.isOpenAccess === "Y" ? true : r.isOpenAccess === "N" ? false : null,
        url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : `https://europepmc.org/article/${r.source || "MED"}/${id}`,
    };
}
