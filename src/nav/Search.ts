// A search source — what a `$search_<name>.ts` file default-exports. When the person types in the global menu
// (⌘/), every source of the current tab is asked in parallel and its results appear as one group.
//
// search must only read, and must check access for the current viewer itself. It runs with a short timeout;
// `signal` aborts when the budget runs out, so stop expensive work when it fires.
export type Search = {
    /** Group title above this source's results. */
    title: string;
    /** Phosphor icon class for the group and default row icon. */
    icon?: string;
    /** Typing this prefix first (`@`, `#`, `/`) searches only this source. */
    prefix?: string;
    /** Group position, lower first. @default 100 */
    order?: number;
    /** Returns up to `limit` matching rows. */
    search: (ctx: Context, session: Session | null, opts: { q: string; limit: number; signal?: AbortSignal }) =>
        types.nav.Item[] | Promise<types.nav.Item[]>;
};
