export default {
    type: 'string',
    env: 'JEV_ENDPOINT',
    default: 'https://openrouter.ai/api/v1/systemone',
    title: 'Jev System One endpoint',
    description: 'Full URL of the /systemone decision endpoint. OpenRouter by default; https://api.typesafe.ai/v1/systemone for direct TypeSafe access, or a local LitJev/Simple Jev server serving the same contract.',
};
