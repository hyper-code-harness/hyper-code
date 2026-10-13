# Core plugin manager and source providers

## Ownership

`/plugins` is the core plugin manager. Core owns discovery aggregation, installed inventory, source review, confirmation, local drift checks, serialized activation and saved-snapshot rollback. A source provider supplies catalogue entries and inert pinned source files; it does not activate them.

HyperHub is an optional provider for Hyper-git registries. Filesystem is a built-in provider for local plugin directories. Neither provider is a sandbox: mounted provider code is trusted runtime code, while candidate plugin code must remain inert until the user approves activation.

## Declaration

A provider declares `$plugin_provider_<id>.ts`, default-exporting `types.plugins.Provider`. The existing filename grammar classifies this as kind `plugin`, name `provider_<id>`; core owns `$loader_plugin.ts`. No special case is added to the classifier.

```ts
export default {
    apiVersion: 1,
    label: "Example source",
    description: "Find and obtain plugins from this source.",
    handlers: {
        search: "example.providerSearch",
        materialize: "example.providerMaterialize",
    },
} satisfies types.plugins.Provider;
```

Declarations contain runtime procedure names, not arbitrary executable snippets or HTML. Core validates declaration shape, unique identity and current handler ownership. Dispatch resolves only a declared, allowed operation; HTTP callers cannot supply a function name. Provider registration must remain consistent with mounted owners after reload and removal.

## Selection and source contract

A selection identifies `provider`, `name`, immutable `revision`, and an opaque string-valued `source` object. Core preserves the exact identity; two items with the same name from different sources are not interchangeable.

- `search({q?, limit?})` returns `{items, errors}`. Items contain the selection and optional display metadata. Errors from one source must not hide successful results from another.
- `materialize({selection, destination})` writes candidate files into an empty, core-owned staging directory and returns `{path}`. It must verify the immutable revision and must not mount, import or execute candidate code. It must not write into the live plugin directory.
- Optional `configurationHref` links to the provider's own settings page. HyperHub owns hub URLs and repository scopes; core does not reinterpret those settings.

Capabilities follow the handlers actually present. Search-only sources do not acquire install buttons. Mounted filesystem catalogue selections use `mounted:<metadata-sha256>` revisions: these identify displayed package metadata, not content-pinned installable artifacts. The filesystem materializer rejects them. Its separate raw SHA256 selections still require full tree verification; no discovery token bypasses installation validation. Remote publication remains a HyperHub-specific action rather than a mandatory provider capability.

## Core lifecycle

`plugins.lifecycle({operation, selection, confirmed?, expectedDigest?})` handles install, update and rollback. A preview performs bounded structural inspection and source review without activation. Approval is bound to operation, source identity, selected revision, destination, candidate content and prior installed state. Execution requires a fresh matching preview digest and explicit human confirmation.

Staging and backups stay outside automatic plugin mount roots. Before replacing a managed installation, core verifies prior provenance and local content, refuses namespace collisions and unmanaged destinations, and rechecks state before activation. A filesystem source must be pinned and rechecked rather than loading a mutable working directory as if it were an immutable artifact.

Loading trusted code can have irreversible effects. Failed runtime loading must report actual disk and runtime state; renaming directories cannot undo external side effects. Existing module reload/removal APIs are not automatically equivalent to safe uninstall or disabling an auto-mounted directory.

## Compatibility

Legacy HyperHub public entry points remain adapters to core. `/hyperhub` leads to the core catalogue with the HyperHub provider selected; provider-specific configuration stays under `/hyperhub/config`.

Existing HyperHub lock files, digest semantics and snapshot locations must remain readable. Legacy installations without a content digest remain unverified: moving management to core does not silently adopt, overwrite or migrate them. Installed disk state and currently mounted runtime state are separate facts.

## Current scope and verification

Filesystem catalogue discovery currently covers already mounted local plugin roots, not arbitrary directory browsing. Such entries are discovery-only in the UI; installation over their owned namespaces is refused. Discovery reads bounded package metadata (`procs.label`, `procs.description`, `procs.icon`, and package `version`) without applying managed-copy tree restrictions, so `.git`, `node_modules`, scripts or dependencies do not hide valid existing mounts. Managed-copy validation supports dependency-free packages without scripts or symlinks and requires namespace directories under the source root. These restrictions do not mean an existing developer plugin is invalid.

The installed tab inventories the local `USER_PLUGINS` disk separately from runtime mounts. Catalogue allocation is round-robin across providers with a global cap of twenty; a large filesystem catalogue cannot hide the remote provider. Verified saved-snapshot rollback can work without the original provider mounted.

After this migration, 86 targeted tests passed (380 assertions) across core provider/lifecycle/UI and HyperHub suites. Fifteen core/adapter runtime functions passed strict documentation validation and per-function typechecking. Browser checks covered `/plugins`, `/plugins/config`, the Installed tab, and the `/hyperhub` compatibility redirect. The existing demo package, provenance lock and function retained identical SHA-256 hashes. No candidate was installed or published during migration. Older unrelated core plugin fixtures still depend on missing mounted plugins; this is not a claim that the entire repository test suite passes.

