export default {
    type: 'secret',
    env: 'CLAUDE_PROXY_TOKEN',
    default: null,
    title: 'Claude proxy token',
    description: 'Bearer token presented to the Claude proxy host (its llm.proxyToken).',
};
