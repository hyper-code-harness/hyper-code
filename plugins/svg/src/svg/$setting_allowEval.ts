export default {
    type: 'boolean',
    env: 'SVG_ALLOW_EVAL',
    default: false,
    title: 'Allow computed SVG fences',
    description: 'Allow ```svg tsx fences to execute TSX on the server with full ctx access. Not a sandbox and not read-only: the code can call any runtime function. It runs again on every render, including reopened history. Enable only when all rendered Markdown is trusted, and keep drawings read-only.',
};
