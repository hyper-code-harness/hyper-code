// The data-* automation markers that make a page drivable: page.click, the agent's helpers and tests find
// things on screen by them, so every module spells them through this one function.
//
//   `<section ${ctx.fns.w.marks({ page: "questionnaire" })}>`
//   `<tr ${ctx.fns.w.marks({ entity: "Patient", id: "pt-1", status: "active" })}>`
//
//   page    the root of a module's page — one per page
//   section a named region of the page (what a tour points at)
//   entity  a thing: a row, a card, a tab; `id` says which one
//   id      the entity's identity, or the subject of an action
//   status  the entity's state (running, draft, error)
//   role    a part of an entity — the cell a value is read from
//   form    a form (or its container), addressable by fill/submit
//   action  a control that does something — the verb, not the label
// Any other key is written as data-<key> too; empty values are dropped.

/**
 * Renders escaped data-* automation markers (page, section, entity, id, status, role, form, action, or any other
 * key) as an attribute string; null, undefined and empty values are omitted. Use it instead of writing data-*
 * markers by hand so the agent's page helpers can find controls and records.
 * @param opts Marker values keyed by marker name (without the data- prefix).
 */
export default function (ctx: Context, _session: Session | null, opts: Record<string, string | number | boolean | null | undefined>): string {
    const out: string[] = [];
    for (const key of Object.keys(opts)) {
        const value = opts[key];
        if (value === null || value === undefined || value === "") continue;
        out.push(`data-${key}="${ctx.fns.w.escape({ text: String(value) })}"`);
    }
    return out.join(" ");
}
