// `@canvas <kind>`: the function returns data AND, called with `canvas: true`, shows the same selection to the
// person on a canvas tab of that kind (reusing the tab). canvas.search lists these functions.
export default {
    summary: "Returns data and, with canvas: true, shows the same selection on a canvas tab of this kind",
    arg: "kind",
} satisfies types.runtime.docs.Tag;
