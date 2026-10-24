export default {
    type: 'string', default: '', title: 'SSH CLI instances',
    description: 'Comma-separated SSH config aliases explicitly enabled for remote Codex and Claude inference. Requires manual login in ~/.hyper/ssh-accounts/<provider>/default on each Linux host. No local credential fallback.',
};
