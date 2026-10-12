export default {
    type: 'boolean',
    env: 'CANVAS_ALLOW_EVAL',
    default: false,
    title: 'Allow server code in html canvas tabs',
    description: 'Lets an html canvas tab carry `load`: JavaScript run on the server with full ctx access each time the tab is shown, whose JSON result the page gets as hyper.data. Not a sandbox — enable only for trusted agents and keep the code read-only. The page itself always runs sandboxed in the browser.',
};
