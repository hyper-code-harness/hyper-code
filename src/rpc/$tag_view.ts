// `@view`: the function returns a page (an html fragment, or rows shown as a table) and is meant only to read,
// so it opens by address — GET /rpc/<fn>?<json>, a canvas `view` tab, a link. GET /rpc refuses functions
// without it. The tag states an intent, it does not prove the function changes nothing: keep views read-only.
export default {
    summary: "Read-only page by address: GET /rpc/<fn>?<json>, a canvas view tab or a link",
} satisfies types.runtime.docs.Tag;
