/**
 * Validate typed scenario actors, messages, actions and nested phases before rendering
 *
 * Use before storing or rendering small JSON interaction models. Throws on unsupported fields or step types (including check and stop), invalid XML text, duplicate global IDs, missing actors, cycles, more than 30 actors or 200 total steps, or more than eight phase levels. Empty scenarios, labels and phases are accepted. Does not execute actions or verify protocol semantics. Input is not mutated.
 * @param opts.model Strict JSON scenario with ordered actors and discriminated steps; IDs up to 128 characters and labels/titles up to 300 characters.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Strict JSON scenario with ordered actors and discriminated steps; IDs up to 128 characters and labels/titles up to 300 characters. */
        model: types.diagrams.Scenario;
    },
): Promise<{ valid: true; actors: number; steps: number; phases: number; messages: number; actions: number }> {
    const model: unknown = opts.model;
        const ids = new Set<string>(), actors = new Set<string>(), active = new WeakSet<object>();
        const counts = { valid: true as const, actors: 0, steps: 0, phases: 0, messages: 0, actions: 0 };
        const object = (v: unknown, keys: string[], where: string): Record<string, unknown> => {
         if (!v || typeof v !== 'object' || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) throw new Error(where + ' must be a JSON object');
         for (const k of Object.keys(v)) if (!keys.includes(k)) throw new Error(where + ': unsupported field ' + k);
         return v as Record<string, unknown>;
        };
        const text = (v: unknown, max: number, where: string): string => {
         if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(v)) throw new Error(where + ': invalid XML text or length');
         return v;
        };
        const id = (v: unknown) => { const s = text(v, 128, 'id'); if (!s.trim() || ids.has(s)) throw new Error('IDs must be globally unique and nonblank: ' + s); ids.add(s); return s; };
        const root = object(model, ['id','title','actors','steps'], 'model');
        if (root.id !== undefined) id(root.id);
        if (root.title !== undefined) text(root.title,300,'title');
        if (!Array.isArray(root.actors) || root.actors.length > 30) throw new Error('Limit: 30 actors');
        for (const value of root.actors) { const a = object(value,['id','label'],'actor'); actors.add(id(a.id)); text(a.label,300,'actor label'); counts.actors++; }
        const ref = (v: unknown) => { if (typeof v !== 'string' || !actors.has(v)) throw new Error('Unknown actor reference'); };
        const walk = (value: unknown, depth: number) => {
         if (!Array.isArray(value)) throw new Error('steps must be an array');
         if (active.has(value)) throw new Error('Cyclic scenario');
         if (value.length > 200) throw new Error('Limit: 200 steps');
         active.add(value);
         for (const raw of value) {
          if (++counts.steps > 200) throw new Error('Limit: 200 steps');
          if (!raw || typeof raw !== 'object') throw new Error('Invalid step');
          if (active.has(raw)) throw new Error('Cyclic scenario');
          const type = (raw as Record<string,unknown>).type;
          if (typeof type !== 'string' || !['message','action','phase'].includes(type)) throw new Error('Unsupported step type: ' + String(type));
          const s = object(raw, type === 'message' ? ['type','id','from','to','label','kind'] : type === 'action' ? ['type','id','actor','label'] : ['type','id','title','steps'], 'step');
          id(s.id); active.add(raw);
          if (type === 'message') { ref(s.from); ref(s.to); text(s.label,300,'message label'); if (typeof s.kind !== 'string' || !['request','reply','send','redirect'].includes(s.kind)) throw new Error('Unsupported message kind'); counts.messages++; }
          else if (type === 'action') { ref(s.actor); text(s.label,300,'action label'); counts.actions++; }
          else { if (depth >= 8) throw new Error('Limit: eight phase levels'); text(s.title,300,'phase title'); counts.phases++; walk(s.steps,depth+1); }
          active.delete(raw);
         }
         active.delete(value);
        };
        walk(root.steps,0);
        return counts;
}
