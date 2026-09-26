const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UA = "hyper-code2-medsearch/1.0 (biomedical literature client)";

/** Calls an official NCBI E-utilities JSON endpoint with conservative shared rate limiting. Use as MedSearch's low-level PubMed transport. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** E-utilities endpoint without the `.fcgi` suffix. */ endpoint: "esearch" | "esummary" | "elink";
        /** Query parameters accepted by that NCBI endpoint. */ params: Record<string, string>;
    },
): Promise<any> {
    const state = ((ctx.state as any).medsearchPubmed ??= { lastRequestTs: 0 });
    const wait = Math.max(0, 350 - (Date.now() - state.lastRequestTs));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const params = new URLSearchParams({ db: "pubmed", retmode: "json", ...opts.params });
    const res = await fetch(`${BASE}/${opts.endpoint}.fcgi?${params}`, { headers: { "user-agent": UA } });
    state.lastRequestTs = Date.now();
    const text = await res.text();
    if (!res.ok) throw new Error(`NCBI ${opts.endpoint} ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { throw new Error(`NCBI ${opts.endpoint}: invalid JSON`); }
}
