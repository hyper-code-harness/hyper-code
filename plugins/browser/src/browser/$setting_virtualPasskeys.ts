export default {
    type: 'boolean',
    env: 'BROWSER_VIRTUAL_PASSKEYS',
    default: true,
    title: 'Shared Chrome: virtual passkeys',
    description: 'Put a WebAuthn virtual authenticator on every tab of the shared Chrome, so a page asking for a passkey never opens the macOS passkey / iCloud Keychain window (which nobody can see on a headless user and which stalls Chrome). Real passkeys are then not usable in that Chrome.',
};
