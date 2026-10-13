export default {
    type: 'boolean',
    env: 'VEGALITE_ALLOW_EVAL',
    default: false,
    title: 'Allow executable chart fences',
    description: 'Allow vega-lite eval fences to execute async JavaScript with full server ctx access. Not sandboxed or read-only enforced. Runs on every render, including reopened documents. Enable only when all rendered Markdown is trusted; use read-only expressions without side effects.',
};
