export default {
    type: 'string',
    env: 'DECISION_OPENAI_MODEL',
    default: 'gpt-6-luna',
    title: 'OpenAI decision model id',
    description: 'Model sent to /v1/decisions. gpt-6-luna is the only model available during the public beta; input is billed at $0.10 per 1M tokens and output is free.',
};
