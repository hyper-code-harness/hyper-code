export default {
    type: 'json',
    env: 'PLUGIN_HOME',
    default: null,
    title: 'Plugin home',
    description: 'Where this Hyper publishes its own plugins when plugins.publish is called without a repository: the git server of its private network. Either the server address (https://git.example.org) or { "server": "https://git.example.org", "owner": "team", "listing": "https://git.example.org/git/shared/plugins-index.git" }. The server is asked who this Hyper is (GET /api/whoami): a Hyper it knows as a server publishes under its own team and needs only the address; a Hyper that reaches it as a person must name the owner its plugins go under. The listing defaults to the one the server names. Env PLUGIN_HOME takes the address or the JSON. Empty: plugins.publish needs an explicit repo.',
};
