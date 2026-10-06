export default {
    type: 'string',
    env: 'BROWSER_LIVE_CDP_URL',
    default: null,
    title: 'Live view: Chrome DevTools endpoint',
    description: 'Chrome DevTools HTTP endpoint shown by the live view (/browser/live) when a link does not name one. Empty uses CDP_BROWSER_URL, then http://127.0.0.1:9222.',
};
