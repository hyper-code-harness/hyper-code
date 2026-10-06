export default {
    type: 'number',
    env: 'BROWSER_LIVE_QUALITY',
    default: 70,
    title: 'Live view: JPEG quality',
    description: 'JPEG quality (10–100) of the screencast frames Chrome sends to the live view. Lower is faster over slow links.',
};
