export default {
    apiVersion: 1,
    label: 'Local filesystem',
    description: 'Read-only discovery of trusted mounted plugin roots. Managed copies require dependency-free code and explicit source review; existing mounts are never activated in place.',
    icon: 'folder',
    handlers: { search: 'plugins.filesystemSearch', materialize: 'plugins.filesystemMaterialize' },
} satisfies types.plugins.ProviderDescriptor;
