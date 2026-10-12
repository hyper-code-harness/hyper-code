/** One tab on an agent's canvas: a kind, the arguments it was opened with, and its own small state. */
export type Item = {
    /** Tab id. */
    id: number;
    /** Agent the tab is pinned to. */
    agentId: string;
    /** Kind name from the canvas catalog, e.g. file. */
    kind: string;
    /** Tab title. */
    title: string;
    /** Arguments the kind was opened with (after its prepare). */
    args: Record<string, any>;
    /** The tab's own state (scroll, selection, edits…), kept across reloads. */
    state: Record<string, any>;
    /** This tab is the one shown. */
    active: boolean;
};
