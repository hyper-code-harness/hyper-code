// What a server WebSocket carries on `ws.data` for a `$ws_<path>.ts` endpoint.
export type WsData = {
    endpoint: types.procs.http.WsEndpoint;
    ctx: Context;
    session: Session | null;
    params: Record<string, string>;
    path: string;
    url: string;
    /** Whatever the endpoint's `upgrade` returned; free for the endpoint to mutate. */
    state: any;
};
