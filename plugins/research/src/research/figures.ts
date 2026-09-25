/**
 * Extracts figure and table references from a Consensus synthesis and builds authenticated image URLs
 *
 * Extract figure_reference and figure_caption markup returned by Consensus AI synthesis. Use after research.ask, or with thread_id and interaction_id to fetch that synthesis. Images are only available when Consensus emits a reference for an open-access cited paper; this function does not extract arbitrary publisher PDFs or promise a figure for every citation.
 * @param opts.answer_md Consensus synthesis markdown returned by research.ask; when omitted, thread_id and interaction_id are required.
 * @param opts.thread_id Consensus thread identifier used to fetch the interaction when answer_md is omitted.
 * @param opts.interaction_id Consensus interaction identifier used to fetch the interaction when answer_md is omitted.
 * @param opts.browser_session Chrome CDP session holding Consensus cookies. @default research-consensus
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Consensus synthesis markdown returned by research.ask; when omitted, thread_id and interaction_id are required. */
        answer_md?: string;
        /** Consensus thread identifier used to fetch the interaction when answer_md is omitted. */
        thread_id?: string;
        /** Consensus interaction identifier used to fetch the interaction when answer_md is omitted. */
        interaction_id?: string;
        /** Chrome CDP session holding Consensus cookies. @default research-consensus */
        browser_session?: string;
    },
): Promise<{ figures: Array<{ paper_id: string; label: string; caption: string; image_path: string; image_url: string; kind: "figure" | "table" | "unknown" }>; captions: Array<{ number?: string; description?: string }>; count: number; availability: "available" | "none_in_synthesis" }> {
    const browserSession = opts.browser_session ?? "research-consensus";
    let markdown = String(opts.answer_md ?? "");
    if (!markdown) {
        const threadId = String(opts.thread_id ?? "").trim();
        const interactionId = String(opts.interaction_id ?? "").trim();
        if (!threadId || !interactionId) throw new Error("research.figures: provide answer_md or both thread_id and interaction_id");
        const interaction: any = await ctx.fns.research.call({
            session: browserSession,
            path: `/api/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(interactionId)}/`,
        });
        markdown = String(interaction?.analysis ?? "");
    }
    const attribute = (source: string, name: string): string | undefined => {
        const match = source.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`));
        return match?.[1] ?? match?.[2];
    };
    const decode = (value: string): string => value
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    const figures = [...markdown.matchAll(/<figure_reference\s+([^>]*?)\/?\s*>/gi)].flatMap(match => {
        const attrs = match[1] ?? "";
        const paper_id = attribute(attrs, "paper_id");
        const label = attribute(attrs, "label");
        const caption = attribute(attrs, "caption");
        if (!paper_id || !label || !caption) return [];
        const decodedLabel = decode(label);
        const decodedCaption = decode(caption);
        const query = new URLSearchParams({ caption: decodedCaption, label: decodedLabel });
        const image_path = `/api/papers/figure/${encodeURIComponent(paper_id)}?${query.toString()}`;
        const normalized = decodedLabel.trim().toLowerCase();
        const kind: "figure" | "table" | "unknown" = normalized.startsWith("table") ? "table" : normalized.startsWith("fig") ? "figure" : "unknown";
        return [{ paper_id, label: decodedLabel, caption: decodedCaption, image_path, image_url: `https://consensus.app${image_path}`, kind }];
    });
    const captions = [...markdown.matchAll(/<figure_caption\s+([^>]*?)\/?\s*>/gi)].map(match => {
        const attrs = match[1] ?? "";
        const number = attribute(attrs, "number");
        const description = attribute(attrs, "description");
        return { ...(number ? { number: decode(number) } : {}), ...(description ? { description: decode(description) } : {}) };
    });
    return { figures, captions, count: figures.length, availability: figures.length ? "available" : "none_in_synthesis" };
}
