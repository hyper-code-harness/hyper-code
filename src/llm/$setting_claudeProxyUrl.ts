export default {
    type: 'string',
    env: 'CLAUDE_PROXY_URL',
    default: null,
    title: 'Claude proxy URL',
    description: 'Base URL of another Hyper instance relaying Claude subscription calls, e.g. http://localhost:3010/llm/proxy/anthropic. Enables the claude-proxy:<model> provider.',
};
