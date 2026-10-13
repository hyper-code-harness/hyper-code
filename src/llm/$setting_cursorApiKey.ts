export default {
    type: 'secret',
    env: 'CURSOR_API_KEY',
    default: null,
    title: 'Cursor API key',
    description: 'For provider prefix `cursor:` — a user API key from Cursor Dashboard → API & SSH Keys. Runs bill to that key\'s subscription and appear in the Cursor usage dashboard under the SDK tag.',
};
