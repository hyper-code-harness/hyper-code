/** Hyper-git registry discovery and inert pinned retrieval for core plugin lifecycle. */
export default {
    apiVersion: 1,
    label: 'HyperHub',
    description: 'Discover plugins from configured Hyper-git registries and review immutable Git revisions.',
    configurationHref: '/hyperhub/config',
    handlers: { search: 'hyperhub.providerSearch', materialize: 'hyperhub.providerMaterialize' },
};
