export default {
    type: 'string',
    env: 'DECISION_OPENAI_ENDPOINT',
    default: 'https://api.openai.com/v1/decisions',
    title: 'OpenAI Decisions endpoint',
    description: 'Full URL of the OpenAI /v1/decisions endpoint used by the openai decision engine.',
};
