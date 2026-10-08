export default {
    type: 'string',
    env: 'DECISION_ENGINE',
    default: 'jev',
    title: 'Default decision engine',
    description: 'Which backend decision.ask uses when a caller does not pass one: jev (Jev System One, cheapest, text only) or openai (OpenAI Decisions API, accepts images, ZDR/HIPAA eligible).',
};
