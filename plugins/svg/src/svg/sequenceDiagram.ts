/**
 * Compatibility entry point for diagrams.sequenceDiagram. Prefer ctx.fns.diagrams.sequenceDiagram for new diagrams.
 * Requires the official diagrams plugin; retained for existing SVG TSX fences.
 *
 * Render ordered JSON participants and directed messages as a static SVG sequence diagram.
 *
 * Use for small interaction diagrams with participant boxes, lifelines, ordered messages, dashed returns and self-messages. No Mermaid parsing, fragments, activation bars or animation. Up to 30 participants and 200 messages. Labels wrap by estimated character width; input order defines placement. Stable encoded input IDs identify participant groups, message groups and lifelines, scoped to each SVG; returned geometry uses SVG pixels. Empty input produces an empty canvas. Fixed restrained light palette.
 * @param opts.participants Ordered participants with unique nonblank IDs up to 128 characters and labels up to 300 characters.
 * @param opts.messages Ordered directed messages with unique nonblank IDs up to 128 characters, valid participant refs and labels up to 300 characters. Same from/to creates a self-message. dashed defaults to false; use true for returns.
 * @param opts.title Optional accessible heading up to 160 characters.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ordered participants with unique nonblank IDs up to 128 characters and labels up to 300 characters. */
        participants: Array<{ id: string; label: string }>;
        /** Ordered directed messages with unique nonblank IDs up to 128 characters, valid participant refs and labels up to 300 characters. Same from/to creates a self-message. dashed defaults to false; use true for returns. */
        messages: Array<{ id: string; from: string; to: string; label: string; dashed?: boolean }>;
        /** Optional accessible heading up to 160 characters. */
        title?: string;
        /** Pre-layout geometry and visual preset; IBM-inspired is an independent interpretation without IBM assets. @default default */
        theme?: 'default' | 'ibm-inspired';
    },
): Promise<{ svg: string; width: number; height: number; boxes: Array<{ id: string; elementId: string; x: number; y: number; width: number; height: number }>; routes: Array<{ id: string; elementId: string; from: string; to: string; dashed: boolean; points: Array<{x:number;y:number}>; label: {x:number;y:number;lines:string[]} }>; lifelines: Array<{ id:string; elementId:string; x:number; y1:number; y2:number }> }> {
    return await ctx.fns.diagrams.sequenceDiagram({...opts});
}
