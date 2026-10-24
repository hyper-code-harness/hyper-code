// One function tag — what a `$tag_<name>.ts` file default-exports. A tag is a JSDoc block tag on a runtime
// function (`@view`, `@live memory`) that other code acts on: GET /rpc serves only `@view`, canvas.search
// lists `@canvas <kind>`, runtime.docs.search({ tag }) filters by any of them. See docs/function-tags.md.

export type Tag = {
    /** One line: what a function carrying this tag is or can do. Shown in runtime.docs.tags and search docs. */
    summary: string;
    /** The tag takes one word after it (`@live <topic>`): its name, e.g. "topic" or "kind". Omit for a bare tag. */
    arg?: string;
    /** The tag may appear several times on one function (`@canvas a` and `@canvas b`). @default false */
    repeatable?: boolean;
};
