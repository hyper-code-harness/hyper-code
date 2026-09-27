export default {
    type: 'boolean',
    env: 'DESKTOP_KEEP_AWAKE',
    default: true,
    title: 'Keep remote Macs awake while connected',
    description: 'Run `caffeinate -dims` on a remote Mac for exactly as long as the desktop connection to it is open, so its display does not sleep and the screen does not auto-lock mid-task. It cannot unlock an already locked screen. The connection (and caffeinate) closes after desktop.idleDisconnectMinutes without calls.',
};
