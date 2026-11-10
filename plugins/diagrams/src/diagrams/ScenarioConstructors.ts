/** Synchronous JSON constructors for one scenario. Step IDs use a shared factory-local counter (step-1, step-2, ...), deterministic for the same call order; reordering calls changes IDs. Each step helper accepts final options.id to reserve an explicit stable ID. Duplicate allocated IDs throw; generated IDs skip reservations. Independent factories may produce colliding IDs. scenarioValidate/scenarioDiagram enforce global IDs (including root/actors), references and limits. */
export type ScenarioConstructors = {
    /** Create an actor with a globally unique ID and visible label. Register it in model.actors. */
    actor(id: string, label: string): types.diagrams.Actor;
    /** Directed request; actor handles become from/to IDs in the stored step. */
    request(from: types.diagrams.Actor, to: types.diagrams.Actor, label: string, options?: { id: string }): Extract<types.diagrams.Step, { type: 'message' }> & { kind: 'request' };
    /** Directed reply, rendered as a dashed message. */
    reply(from: types.diagrams.Actor, to: types.diagrams.Actor, label: string, options?: { id: string }): Extract<types.diagrams.Step, { type: 'message' }> & { kind: 'reply' };
    /** Directed send without implying request/response protocol semantics. */
    send(from: types.diagrams.Actor, to: types.diagrams.Actor, label: string, options?: { id: string }): Extract<types.diagrams.Step, { type: 'message' }> & { kind: 'send' };
    /** Directed redirect without executing or checking a protocol. */
    redirect(from: types.diagrams.Actor, to: types.diagrams.Actor, label: string, options?: { id: string }): Extract<types.diagrams.Step, { type: 'message' }> & { kind: 'redirect' };
    /** Local action on an actor; the handle becomes an actor ID. */
    action(actor: types.diagrams.Actor, label: string, options?: { id: string }): Extract<types.diagrams.Step, { type: 'action' }>;
    /** Group ordered steps under a title; copies the input array and supports nested phases. */
    phase(title: string, steps: readonly types.diagrams.Step[], options?: { id: string }): Extract<types.diagrams.Step, { type: 'phase' }>;
};
