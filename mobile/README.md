# Hyper Mobile

Hyper Mobile is a native SwiftUI client for a running Hyper server. The primary experience is native: agent discovery, workspace filtering, chat history, live activity, attachments, model switching, context compaction, and chat management. A WebKit fallback remains available for server pages that have not yet been implemented natively.

## Requirements

- macOS with a recent Xcode release
- an iPhone running iOS 17 or later, or an iPhone Simulator
- a running Hyper server
- Bun and the project dependencies installed
- an Apple ID configured in Xcode for installation on a physical device
- an HTTPS tunnel if the phone must connect from outside the server's local network

## 1. Start the Hyper server

From the repository root:

```bash
bun install
bun start
```

Hyper listens on port `3010` by default. Verify it locally:

```bash
curl -I http://127.0.0.1:3010/
```

## 2. Configure password authentication

Do not expose Hyper publicly without authentication. Generate a password hash:

```bash
bun -e 'console.log(await Bun.password.hash(process.argv[1]))' 'choose-a-long-password'
```

Store the resulting hash as the secret setting `auth.password`, or provide it through the server environment:

```bash
HYPER_PASSWORD='$argon2id$...'
```

When authentication is enabled, browsers are redirected to `/auth/login` and the mobile API returns HTTP 401 until the app signs in. See [`docs/auth.md`](../docs/auth.md) for the complete security model.

## 3. Expose Hyper through an HTTPS tunnel

Use any trusted tunnel or reverse proxy that:

- terminates TLS;
- forwards requests to `http://127.0.0.1:3010`;
- preserves cookies and multipart uploads;
- supports long-lived HTTP requests;
- sends `X-Forwarded-Proto: https`.

Example using ngrok:

```bash
ngrok http 3010
```

Example using Cloudflare's temporary tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:3010
```

The result should be an HTTPS URL such as:

```text
https://your-hyper-host.example
```

Verify the protected endpoint:

```bash
curl -I https://your-hyper-host.example/auth/login
```

Do not publish port `3010` directly to the internet. For persistent use, configure a stable hostname rather than a temporary URL.

## 4. Configure the iPhone app

Open the project:

```bash
open mobile/HyperMobile.xcodeproj
```

In Xcode:

1. Select the **HyperMobile** target.
2. Open **Signing & Capabilities**.
3. Enable **Automatically manage signing**.
4. Choose your development team.
5. Change the bundle identifier if the existing identifier is unavailable.
6. Select an iPhone Simulator or a connected iPhone and press **Run**.

On a physical iPhone, enable **Developer Mode** when prompted. The first development build may also require trusting the developer profile in **Settings → General → VPN & Device Management**.

When the app opens:

1. Tap the gear button.
2. Enter the public HTTPS tunnel URL.
3. Tap **Connect**.
4. Enter the Hyper access password when prompted.

The server URL is stored in app preferences. The signed session is stored as an HTTP-only cookie by `URLSession`.

## 5. Install from the command line

After Xcode signing has been configured once, list connected devices:

```bash
xcrun devicectl list devices
```

Build for a physical iPhone:

```bash
xcodebuild \
  -project mobile/HyperMobile.xcodeproj \
  -scheme HyperMobile \
  -configuration Debug \
  -destination 'platform=iOS,id=YOUR_DEVICE_UDID' \
  -derivedDataPath mobile/.derived-device \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build
```

Install the generated application:

```bash
xcrun devicectl device install app \
  --device YOUR_DEVICE_UDID \
  mobile/.derived-device/Build/Products/Debug-iphoneos/Hyper.app
```

Launch it:

```bash
xcrun devicectl device process launch \
  --device YOUR_DEVICE_UDID \
  dev.hyper.mobile
```

Replace the bundle identifier in the final command if it was changed in Xcode.

## Simulator development

The Simulator can connect to a server on the Mac through:

```text
http://localhost:3010
```

For testing the real deployment path, use the same HTTPS tunnel URL as a physical iPhone. Camera capture is unavailable in Simulator, but photo-library and file-import flows can still be tested.

## Mobile API

The native app uses the versioned JSON API under `/api/mobile/v1`. Major operations include:

- listing, creating, archiving, pinning, and deleting agents;
- reading paginated chat events and live response state;
- sending JSON or multipart messages;
- uploading photos and files;
- marking chats read;
- stopping agents and compacting context;
- listing and changing models.

The API delegates to existing Hyper session, agent, attachment, and queue procedures rather than duplicating runtime logic.

## Security notes

- Always use HTTPS outside a trusted LAN.
- Use a long unique password and store only its Argon2 hash.
- Keep the tunnel client and Hyper process supervised for persistent deployments.
- Restrict tunnel access by identity or network policy when the provider supports it.
- The current password mode is intended for a trusted single-user deployment; it is not a multi-user authorization system.
- Development signing is temporary. Use TestFlight or App Store distribution for durable remote installation and updates.

## TestFlight

One command from Hyper (eval): `await ctx.fns.mobiledev.testflight({ confirm: true, upload: true })` — bumps `CFBundleVersion`
(Info.plist + project), archives Release, exports with `ExportOptionsHealthKit.plist` (Apple Distribution, profile
"Hyper Code HealthKit App Store") and uploads with altool using the App Store Connect API key from 1Password
(`Hyper App Store Connect API`, cached in the secrets store; never in git). Logs: `mobile/.runtime/testflight-build<N>-*.log`.
The internal group "internal" has access to all builds, so a processed build appears in TestFlight automatically (~5–15 min).
Export compliance: `ITSAppUsesNonExemptEncryption = false` (only HTTPS/TLS from the OS).
Commit the bumped build number afterwards.
