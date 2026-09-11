export default {
    type: 'enum',
    env: 'MODEL',
    default: 'claude-code:claude-opus-5',
    options: [
        'claude-code:claude-opus-5',
        'kimi-coding:k3',
        'kimi-coding:k3-256k',
        'kimi-coding:kimi-for-coding',
        'kimi-coding:kimi-for-coding-highspeed',
        'kimi:kimi-k3',
        'kimi:kimi-k2.5',
        'openai:gpt-4o-mini',
        'openai:gpt-4o',
        'openrouter:anthropic/claude-3.5-sonnet',
    ],
    title: 'Default model',
    description: 'Used when no model is given to ctx.fns.ui.createAgent / /agent/new.',
};
