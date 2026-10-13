# Hyper-git plugin registry

## Ownership

The registry is part of the separate `hyper-git` service. Git is the source of truth; indexing reads committed files without checking out or executing a plugin. The first-party `hyperhub` plugin supplies registry discovery, pinned Git retrieval and publication as a source provider. The core plugin manager owns the common UI, installed state, review and activation; see [Plugin providers](plugin-providers.md). Existing HyperHub installation entry points remain compatibility adapters. The existing core `git` namespace remains unchanged.

The server implementation lives in `~/hyper-git/src/registry`; its authoritative deployment and HTTP contract documentation is `~/hyper-git/docs/registry.md`. These paths describe this development checkout, not a runtime dependency of Hyper.

## Publication contract

A plugin contains `package.json` with a package `name`, a `procs` object, and `SKILL.md`. For example:

```json
{
  "name": "example",
  "version": "0.1.0",
  "type": "module",
  "procs": {
    "src": "src",
    "description": "A precise description of the supported capability"
  }
}
```

A repository containing several plugins declares exact relative directories in its root `package.json`:

```json
{
  "name": "team-plugins",
  "procs": {
    "registry": { "paths": ["plugins/example", "plugins/other"] }
  }
}
```

This is different from the existing `procs.plugins` runtime search-root configuration. There is no explicit registry registration request: pushing the default branch makes the server discover and validate the declared plugins. Installation remains an explicit, separate action.

## Current server design

- Opt-in with `REGISTRY_ENABLED=1`; it is not enabled or deployed by editing the source.
- Reads the repository's symbolic default branch, not every pushed branch.
- Reconciles at startup, after receive-pack completion, and periodically. It reads actual refs rather than treating HTTP success as proof that Git accepted a push.
- A disposable in-memory index replaces the initially proposed PostgreSQL queue for the first version. It is rebuilt from Git; this is not a durable job system.
- `GET /api/registry/search` accepts optional `repo`, `q`, and `limit`.
- `GET /api/registry/get` accepts `repo` and `name`.
- `GET /api/registry/resolve` accepts `repo`, `name`, and optional exact `commit`. An explicitly requested commit must remain reachable from the current default branch.
- Invalid or removed manifests are withdrawn from search. Repository-scoped search reports indexing errors.

For reproducible installation, record the repository, plugin name, path and full commit returned by resolve. A manifest's version string alone is not immutable identity. A force-push can make a previously indexed commit unavailable through resolve.

## Security boundaries

Registry reads use the Git server's existing repository read authorization. Resource tickets require repository-scoped searches. Global HN search authenticates the caller and applies the repository authorization hook to each result.

**The current local hyper-git HN authorization hook allows every authenticated HN actor access to every repository.** The registry does not implement team isolation or fix that policy. Do not describe private/team visibility as enforced until that hook is replaced and tested. Network identity is not a substitute for repository authorization.

Indexing does not import TypeScript, run package scripts or install dependencies. Installation is different: a mounted Hyper plugin executes with Hyper's privileges. Preview and explicit approval are required before publication or activation. Staging must stay outside `USER_PLUGINS`, whose children are automatically mountable. Existing local plugin directories must never be silently overwritten.

The client does not change the behavior or return shape of the existing mounted-plugin `plugins.search`; registry discovery belongs to the `hyperhub` plugin. Its public operations are `hyperhub.search`, `hyperhub.get`, `hyperhub.resolve`, `hyperhub.publish` and `hyperhub.install`. Use live runtime documentation for their exact arguments once loaded.

## HyperHub publication and installation

Read `plugins.read({ name: "hyperhub" })` for the guided workflow and generated function signatures.

- `hyperhub.publish({ dir, baseUrl, repo })` previews an isolated snapshot of a plugin folder. It does not stage or push its enclosing repository. Publication can preserve the existing matching root plugin's Git history. Preview binds the exact remote main commit; confirmation rejects drift and never force-pushes. `createRepo: true` allows creating a missing repository only after approval. Non-plugin or mismatched repositories are rejected.
- Show the destination, file list and returned digest; request confirmation with the chat confirmation form. Only an approved request may repeat the call with `confirmed: true` and `expectedDigest`.
- `hyperhub.install({ baseUrl, repo, name, commit })` previews a pinned plugin. Repeat with the reviewed digest and explicit confirmation to activate it. A local lock record retains its source and commit.
- The first version supports dependency-free plugins with unscoped names, rejects package scripts and links, and never runs a package manager. It rejects existing destination folders and namespace collisions instead of overwriting local work.
- Source folders containing `.git` or `node_modules` are rejected. Supply a standalone plugin subtree, not the entire Hyper repository.
- The client currently uses network identity for registry HTTP reads; it has no Bearer-ticket secret integration. Git transport can use its existing credential configuration. Supply a credential-free HTTPS origin.
- Structural file-size checks do not bound the bytes Git receives into its temporary pack before inspection. This is a known resource-isolation limitation; do not treat remote code or transport as sandboxed.

## Earlier registry verification (before the core-provider migration)

At that checkpoint the server suite passed 57 tests (520 assertions), with one optional PostgreSQL metadata test skipped; its TypeScript check passes. HyperHub passes 55 tests (244 assertions), covering HTTP/command limits, publication history and guards, catalogue UI, install/update/rollback, local drift and partial loader failure. Publication uses temporary real Git repositories; lifecycle loading is mocked, not a claim of transactional runtime rollback. All sixteen runtime functions pass strict documentation validation and per-function typechecking. Existing core Git tests also pass (8 tests).

A broader `src/plugins` regression run is not green: eight tests depend on plugins or mocks absent from the current isolated test harness (including arxiv/research/browser and markdown). This work does not claim to fix those unrelated fixtures or to have a green whole-Hyper test suite.

Live runtime smoke check: previewing the HyperHub directory itself returns `published: false`, no commit, a file list and a destination-bound digest; no network publication occurs. HyperHub appears in capability search after reloading and indexing.

## Marketplace lifecycle and verified rollout

The common UI now belongs at `/plugins`, with catalogue cards and an offline Installed tab. `/hyperhub` is a compatibility entry to the HyperHub provider; `/plugins/config` lists providers and links to their settings. `hyperhub.registryUrl` defaults to empty and is saved only by explicit POST. Different-commit badges do not claim semantic version ordering. Review agents choose install, update or rollback from exact provenance and require genuine human confirmation.

`plugins.installed({})` reports unmanaged, legacy, managed or modified state; `hyperhub.installed({})` remains a compatibility entry point. `update` and `rollback` use the shared lifecycle lock, contentDigest checks, bounded source review and file diff. Backups stay outside USER_PLUGINS. Legacy locks lacking contentDigest are refused rather than silently trusting current files. Filesystem replacement uses two renames with a recovery path, not an atomic swap. A failed loader returns a partial-state status and does not claim to undo executed code effects.

The initial registry was deployed with the live workload ACL preserved: server identities are limited to their team repository prefix, while admitted people still have broad repository access. This differs from the local allow-all source hook discussed above. The approved real E2E published `niquola/hyperhub-demo` at `8ec6005c38a65de9fdddb936659f24d320a0888c`, found it, installed it and called hello successfully. This original installation remains unchanged and is classified legacy by the new lifecycle.

The subsequent marketplace/update/rollback work was verified locally with temporary fixtures only. It did not publish a new demo version or update any existing user plugin. Further outward actions require explicit approval.
