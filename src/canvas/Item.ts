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
    /** When the tab was first opened, ms since epoch. */
    createdAt: number;
    /** When the tab last changed (opened again, retitled, state saved), ms since epoch. */
    updatedAt: number;
    /** Pinned: kept at the left of the strip as an icon, without a close button. */
    pinned: boolean;
    /** When the tab was closed, ms since epoch; null while it is open. */
    closedAt: number | null;
};
