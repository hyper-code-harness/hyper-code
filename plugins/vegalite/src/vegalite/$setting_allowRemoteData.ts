// Vega's own loader fetches `data: { url: "https://..." }` during render, which
// turns any rendered fence into a request from this server. Off by default: a
// chart in a document should not be able to reach the network or a metadata
// endpoint just because it was displayed.
export default {
    type: 'boolean',
    env: 'VEGALITE_ALLOW_REMOTE_DATA',
    default: false,
    title: 'Allow remote data urls',
    description: 'Let chart specs load data over http(s). Off means only local files under the data root; a remote url is reported as an error instead of being fetched.',
};
