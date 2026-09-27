/** Reports availability of the unified PDF parser's Marker and MinerU engines and its auto-routing policy.
 * Use before conversion to diagnose local runtimes and understand which engine will handle each document class.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{
    ok: boolean;
    marker: Awaited<ReturnType<typeof ctx.fns.marker.status>>;
    mineru: Awaited<ReturnType<typeof ctx.fns.mineru.status>>;
    policy: Array<{ when: string; engine: "marker" | "mineru"; mode: string; reason: string }>;
}> {
    const [marker, mineru] = await Promise.all([ctx.fns.marker.status({}), ctx.fns.mineru.status({})]);
    return {
        ok: marker.installed && mineru.installed,
        marker,
        mineru,
        policy: [
            { when: "born-digital narrative/report/ECG/prescription", engine: "marker", mode: "auto (usually fast)", reason: "Fast, compact transcription with fewer generated descriptions." },
            { when: "laboratory or pathology result table", engine: "mineru", mode: "vlm-engine", reason: "HTML tables preserve multi-row headers, units, rowspan, and colspan." },
            { when: "fully scanned PDF", engine: "mineru", mode: "vlm-engine", reason: "Apple Silicon MLX VLM avoids Marker/Surya CPU OCR latency and MPS retries." },
            { when: "mixed PDF with mostly digital pages", engine: "marker", mode: "balanced", reason: "Preserves embedded text while selectively applying OCR." },
        ],
    };
}
