export default {
    type: 'json',
    env: 'PLUGIN_LISTINGS',
    default: ['https://raw.githubusercontent.com/hyper-code-harness/plugins/main/index.json'],
    title: 'Plugin listings',
    description: 'Ordered list of plugin listing index.json addresses (https:// or file://) the catalog reads. A plugin name found in several keeps the first listing\'s entry. Env PLUGIN_LISTINGS takes the addresses separated by commas or spaces.',
};
