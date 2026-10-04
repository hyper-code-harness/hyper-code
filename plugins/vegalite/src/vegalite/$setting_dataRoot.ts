// Where a chart's `data: { url: "..." }` is allowed to read from. A relative
// url in a spec resolves under this directory and may not escape it, so a
// Markdown fence written by anybody — an agent, a doc, a pasted answer — can
// only reach the tree the user pointed this setting at.
export default {
    type: 'string',
    env: 'VEGALITE_DATA_ROOT',
    default: '',
    title: 'Vega-Lite data root',
    description: 'Directory that relative data urls in chart specs resolve under, and the only tree /vegalite/data serves. Empty means the project root.',
};
