export default {
    type: 'number',
    env: 'DESKTOP_WINDOW_CHANGE_TIMEOUT_MS',
    default: 250,
    title: 'Cua Driver post-action window watch (ms)',
    description: 'How long the Cua Driver daemon watches for new windows after each action (its built-in default is 1000 ms, which makes every click and key ~1 s slower). desktop.* ensures the daemon on each host runs with this value on first connect and restarts it when it differs. 0 leaves the daemon untouched.',
};
