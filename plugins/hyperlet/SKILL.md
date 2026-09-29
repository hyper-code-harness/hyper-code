---
name: hyperlet
description: "Publish a service you started on this machine to your team over the VPN. Start it on 127.0.0.1:<port>, call hyperlet.publish({ name, port }) and get https://<name>.<team>.in.hs.hyper-mesh.xyz with a real certificate, reachable only through NetBird. Use when the user wants to show, share or open a web app, demo, API or dashboard you run; list/unpublish manage what is exposed."
---

# Hyperlet — publish local services to the team VPN

This Hyper runs under a team user (for example `cs` or `marketing`) on a machine with the Hyperlet agent (`hyperlet@<user>`). The agent announces the services listed in `~/.config/hyperlet/config.json` to the control plane. The control plane routes `https://<name>.<team>.in.hs.hyper-mesh.xyz` through the VPN gateway (Traefik, wildcard TLS) to this machine. Nothing is public: only NetBird users can open it.

## Workflow

1. Start the service bound to **127.0.0.1** on a port ≥ 1024 (not 0.0.0.0), as the same OS user as this Hyper. Keep it running (e.g. a background process or a user unit), otherwise the link breaks.
2. `hyperlet.publish({ name: "demo", port: 18765 })` → `{ url, host, status }`. It checks the port answers locally, adds the service to the agent config and waits until the control plane confirms (usually < 5 s).
3. Give the user the `url`.
4. `hyperlet.list({})` shows what is published and whether each service is up; `hyperlet.unpublish({ name })` removes it.

## Rules

- `name`: lowercase letters, digits, `-` (e.g. `demo`, `report-api`). It becomes the first label of the host name.
- `kind`: `http` (default, `/repl` blocked), `hyper` (a Hyper instance; Hyper private paths blocked), `git`.
- `scheme`: `http` (default) or `https` (upstream serves TLS, self-signed is fine).
- Only this user's own loopback listeners are accepted; a port owned by another user is refused by the agent (`refused`).
- Do not publish the Hyper instance itself or change `hyper`/existing entries unless the user asks; list first.
- Access is team-VPN wide. The service must do its own login if its data is private.

## Functions

- `hyperlet.status({})` — agent config path, team, node, last agent report (ok/error, hosts, down, refused).
- `hyperlet.list({})` — published services with url, port, kind, up/down.
- `hyperlet.publish({ name, port, kind?, scheme?, health?, wait? })` — add or update one service.
- `hyperlet.unpublish({ name, wait? })` — remove one service.
