// `@live <topic>`: a `@view` page that follows a live-update topic — when the server calls
// procs.events.refresh({ topic }), every open copy of the page re-fetches itself (docs/live-updates.md).
export default {
    summary: "A view page that re-fetches itself when the server refreshes this live-update topic",
    arg: "topic",
} satisfies types.runtime.docs.Tag;
