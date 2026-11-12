// ctx.state.session — what session.syncAgentState needs to read only the changed tail of a
// transcript instead of the whole of it. Appends are found by idx; an edit of a stored row is
// invisible that way, so every function that edits or removes rows records it here through
// session.markChanged.

export type State = {
    /** Counter bumped by every recorded in-place edit, across all agents. */
    rev?: number;
    /** Agent id → its recent in-place edits. `floor` is the rev of the newest entry already dropped
     *  from the capped log: a sync older than that reloads in full. */
    edits?: Map<string, { floor: number; log: Array<{ rev: number; table: "messages" | "events"; from: number }> }>;
    /** Live agent object → the arrays its last sync produced, their length then, and the rev read before it. */
    synced?: WeakMap<object, Partial<Record<"messages" | "events", { rows: any[]; len: number; rev: number }>>>;
};
