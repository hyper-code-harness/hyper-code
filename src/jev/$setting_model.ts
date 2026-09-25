export default {
    type: 'string',
    env: 'JEV_MODEL',
    default: 'typesafe/jev-1.13',
    title: 'Jev model id',
    description: 'Model id sent in the request body. OpenRouter expects typesafe/jev-1.13; direct TypeSafe accepts the jev-latest alias.',
};
