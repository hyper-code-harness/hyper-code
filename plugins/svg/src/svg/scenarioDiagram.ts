/**
 * Compatibility entry point for diagrams.scenarioDiagram. Prefer ctx.fns.diagrams.scenarioDiagram for new diagrams.
 * Requires the official diagrams plugin; retained for existing SVG TSX fences.
 *
 * Render typed JSON scenarios with real phase bands, actor actions and directed messages
 *
 * Use for small ordered interaction sketches, not executable workflows or security protocol verification. Validates with scenarioValidate; reuses sequenceDiagram actor geometry. Nested phase bands enclose their steps, actions are boxes on actor lifelines, reply arrows are dashed, and every message visibly names its kind. Fixed quiet light styling, estimated text wrapping, stable encoded IDs scoped to the SVG. Empty scenarios and phases supported. Returns SVG-pixel geometry; no activation bars, checks, stops, conditions or branches.
 * @param opts.model JSON source of truth: ordered actors and message/action/phase steps, optional globally unique id and visible title. Maximum 30 actors, 200 total steps and eight phase levels; unknown fields rejected.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** JSON source of truth: ordered actors and message/action/phase steps, optional globally unique id and visible title. Maximum 30 actors, 200 total steps and eight phase levels; unknown fields rejected. */
        model: types.svg.Scenario;
        /** Independent IBM-inspired geometry, padding, type and palette; no branded assets. @default default */
        theme?: 'default' | 'ibm-inspired';
    },
): Promise<{ svg:string; width:number; height:number; actors:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>; messages:Array<{id:string;elementId:string;from:string;to:string;kind:'request'|'reply'|'send'|'redirect';points:Array<{x:number;y:number}>;label:{x:number;y:number;lines:string[]}}>; actions:Array<{id:string;elementId:string;actor:string;x:number;y:number;width:number;height:number;lines:string[]}>; phases:Array<{id:string;elementId:string;depth:number;x:number;y:number;width:number;height:number;lines:string[]}>; lifelines:Array<{id:string;elementId:string;x:number;y1:number;y2:number}> }> {
    return await ctx.fns.diagrams.scenarioDiagram({...opts});
}
