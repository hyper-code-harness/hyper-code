export default {
    type: 'secret',
    env: 'TYPESAFE_API_KEY',
    default: null,
    title: 'TypeSafe API key',
    description: 'Only needed when jev.endpoint points directly at api.typesafe.ai. With the default OpenRouter endpoint the existing llm.openrouterApiKey is reused.',
};
