export default {
    type: 'string',
    env: 'VISION_LMSTUDIO_URL',
    default: 'http://localhost:1234/v1',
    title: 'LM Studio base URL for vision',
    description: 'OpenAI-compatible base URL of the local LM Studio server used by the qwen OCR engine.',
};
