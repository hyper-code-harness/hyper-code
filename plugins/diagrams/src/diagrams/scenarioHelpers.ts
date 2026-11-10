/**
 * Create synchronous typed positional helpers for composing scenario actors and steps
 *
 * Await this factory once per scenario inside a trusted svg tsx fence, then destructure actor, request, reply, send, redirect, action and phase. Call reusable Step[] functions repeatedly without ID prefixes. All step helpers share a factory-local counter generating step-1, step-2, etc.; identical construction order produces identical IDs, but changing call order changes them. An optional final { id } reserves a stable ID; duplicate allocated IDs throw and generated IDs skip reservations. Separate factories have independent ID scopes: do not assume their steps can be merged without collisions. Actor handles become string IDs; phases copy their array. No execution or automatic actor registration occurs. scenarioValidate/scenarioDiagram remain authoritative for root/actor collisions, references, ID syntax and limits. Function-valued results are for in-process use, not HTTP JSON transport.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<types.diagrams.ScenarioConstructors> {
    let counter = 0;
        const reserved = new Set<string>();
        const allocate = (options?: { id: string }): string => {
            if (options !== undefined) {
                if (reserved.has(options.id)) throw new Error(`Duplicate scenario helper step ID: ${options.id}`);
                reserved.add(options.id);
                return options.id;
            }
            let id: string;
            do { id = `step-${++counter}`; } while (reserved.has(id));
            reserved.add(id);
            return id;
        };
        return {
            actor: (id, label) => ({ id, label }),
            request: (from, to, label, options) => ({ type: 'message', id: allocate(options), from: from.id, to: to.id, label, kind: 'request' }),
            reply: (from, to, label, options) => ({ type: 'message', id: allocate(options), from: from.id, to: to.id, label, kind: 'reply' }),
            send: (from, to, label, options) => ({ type: 'message', id: allocate(options), from: from.id, to: to.id, label, kind: 'send' }),
            redirect: (from, to, label, options) => ({ type: 'message', id: allocate(options), from: from.id, to: to.id, label, kind: 'redirect' }),
            action: (actor, label, options) => ({ type: 'action', id: allocate(options), actor: actor.id, label }),
            phase: (title, steps, options) => ({ type: 'phase', id: allocate(options), title, steps: [...steps] }),
        };
}
