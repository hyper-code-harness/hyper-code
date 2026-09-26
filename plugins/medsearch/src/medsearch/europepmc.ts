const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const UA = "hyper-code2-medsearch/1.0 (biomedical literature client)";

/** Calls the official Europe PMC REST API. Use for rich abstracts, identifiers, open-access flags, citation counts and PMC full-text XML. */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** REST path relative to the Europe PMC API root. */ path: string;
        /** Query parameters. @default {} */ params?: Record<string, string>;
        /** Expected response representation. @default "json" */ format?: "json" | "xml";
    },
): Promise<any> {
    const path = String(opts.path || "").replace(/^\/+/, "");
    if (!path) throw new Error("medsearch.europepmc: path is required");
    const params = new URLSearchParams(opts.params ?? {});
    if (opts.format !== "xml" && !params.has("format")) params.set("format", "json");
    const res = await fetch(`${BASE}/${path}${params.size ? `?${params}` : ""}`, { headers: { "user-agent": UA } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Europe PMC ${res.status}: ${text.slice(0, 300)}`);
    if (opts.format === "xml") return text;
    try { return JSON.parse(text); } catch { throw new Error("Europe PMC: invalid JSON"); }
}
