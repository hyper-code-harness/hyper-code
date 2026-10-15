---
name: icons
description: Search a local Lucide SVG catalogue and set consistently sized icons for agent chats.
---

# Icons

Use this plugin to find an icon or give a chat its own Lucide icon without network requests.

1. Translate the visual intent to concise English keywords, then call `icons.search({ query, limit: 5 })`. Search matches upstream Lucide names and tags; it is lexical, not semantic.
2. Call `icons.set({ name })` with an exact returned name to set the calling chat's icon. Pass `id` only to target a specific chat. A known icon name skips search.
3. Use `icons.get({ name })` for raw SVG, or `icons.get({ name, padded: true })` for the chat layout. Search results omit SVG to keep context small.

Chat icons share a 32×32 viewBox and a centered 18×18 drawing area, leaving space inside circular avatars. Core chat sanitization remains authoritative. To restore the model icon use `chat.setIcon({ reset: true })`.

## Canvas browser

Open `canvas.show({ kind: "icons.browser", args: {} })` for the plugin's offline searchable grid. Search uses English names and upstream tags. Click an icon to inspect its SVG and tags or download the SVG. The page runs in a sandbox and does not modify chat icons.

## Assets and license

Bundled offline from lucide-static 1.57.0: 2,154 SVG files and upstream search tags. Source provenance is in assets/source.json. Redistribute with assets/LICENSE (Lucide ISC and inherited Feather MIT notices). No fonts, JavaScript icon bundles or network access are needed at runtime.

## Maintenance

From the repository root run `python3 plugins/icons/scripts/update-assets.py` to reproduce the pinned assets. The script checks the archive SHA-512 against assets/source.json and npm metadata, and replaces generated icons/tags/license only. To intentionally upgrade, change the version in assets/source.json and remove its old integrity first; review the resulting asset and license diff.

Tests: `bun test --no-isolate plugins/icons/src/icons/icons.test.ts` (offline, no database required).
