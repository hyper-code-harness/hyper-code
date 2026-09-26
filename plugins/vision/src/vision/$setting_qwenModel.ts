export default {
    type: 'string',
    env: 'VISION_QWEN_MODEL',
    default: 'qwen3-vl-8b-instruct',
    title: 'Vision model for the qwen engine',
    description: 'LM Studio model identifier used by vision.qwenOcr; any vision-capable model loaded in LM Studio works (e.g. a larger Qwen3-VL).',
};
