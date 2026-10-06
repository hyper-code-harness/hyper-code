export default {
    type: 'string',
    env: 'BROWSER_LIVE_CDP_ALLOW',
    default: null,
    title: 'Live view: other allowed Chrome endpoints',
    description: 'Comma-separated Chrome DevTools endpoints, besides the default one, that a live-view link may name with ?cdp= (for example http://127.0.0.1:9230). Any other endpoint is refused, so a link cannot point the bridge at an arbitrary address.',
};
