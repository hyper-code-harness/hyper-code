// ctx.state.procs?.events — who is listening, and to what.
export type State = {
    // Open event streams: the server pushes to these.
    subs?: Set<(e: any) => void>;
    // The people with an open stream, by id, with how many tabs each has.
    // events/$route__GET.ts adds on connect and removes on disconnect.
    presence?: Map<string, { id: string; name: string; tabs: number; agents: Map<string, number> }>;
};
