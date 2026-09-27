export default {
    type: 'number',
    env: 'DESKTOP_IDLE_DISCONNECT_MINUTES',
    default: 10,
    title: 'Close idle desktop connections after (minutes)',
    description: 'Close a host\'s Cua Driver connection after this many minutes without desktop calls, which also ends its keep-awake caffeinate so the Mac can sleep and lock normally. 0 keeps connections open until the server stops.',
};
