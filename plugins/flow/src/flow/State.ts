/** In-memory declarations and aggregate count cache; gap payloads are never retained. */
export type State = { countCache?: types.flow.CountSnapshot; countRefresh?: Promise<types.flow.CountSnapshot>; declarations: Record<string, {name:string; source:string; fn:(ctx:Context, session:Session|null, opts:types.flow.FlowRequest)=>Promise<types.flow.FlowOutput>}>};
