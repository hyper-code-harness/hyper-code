/** What canvas.show answers: the tab, plus what happened on the way. */
export type Shown = types.canvas.Item & {
    /** The tab's address: `/rpc/<fn>?<json>` for a page of Hyper, the site for a web page; absent for a framed html snapshot. */
    address?: string;
    /** The same thing was already a tab (open or recently closed) and was switched to instead of opening a new one. */
    reused: boolean;
    /** What the server corrected on the way, e.g. Mermaid drawn on the server instead of a CDN script. */
    fixed?: string;
    /** Advice for next time; nothing was changed. */
    hint?: string;
};
