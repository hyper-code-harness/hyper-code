# Credential caching in background Hyper services

This change removes per-request macOS `security` subprocesses without changing stored keys or account ownership. It needs no database migration, package update, or service restart.

## Storage and cache contracts

- **Managed OAuth encryption key**: one validated 32-byte key per process/configuration, concurrent loads shared. Explicit `HYPER_OAUTH_ENCRYPTION_KEY` wins. On macOS, read the configured Keychain service first. An existing validated `HYPER_OAUTH_KEY_FILE` (default `~/.hyper-code2/oauth.key`) remains the headless fallback. Service users without a login keychain rely on this file. An inaccessible store must not cause replacement of its encryption key. Failed loads back off 30 seconds. Returned key bytes are copied.
- **CLI Claude access token**: cache by OS account and credential location until `expiresAt`. Cold reads and expiry refreshes are singleflight. HTTP 401 passes the exact rejected bearer to the refresh function; a late failure cannot invalidate its replacement. Failed reads/refreshes back off 30 seconds. A rotated pair retained after failed persistence is reused on the next refresh only while the stored original pair remains unchanged. External changes/deletion win. Subprocesses are asynchronous and bounded (5 seconds); OAuth exchange is bounded (15 seconds).
- **Credential presence**: five-minute positive cache, ten-second negative cache, singleflight, two-second asynchronous Keychain deadline. `force:true` bypasses a completed probe after login.
- **Account inventory**: five-second singleflight cache. Quota, authentication health and node state are still evaluated live.
- **Mutations**: login/registry/removal clear the affected cache maps and advance a revision to fence older refreshes. Removal blocks new refreshes and drains tracked refresh/write flights before deleting credentials. Managed OAuth save/logout invalidate inventory. Token/secret values are never included in diagnostics.

`llm.fetchClaudeCode` wraps local calls, streaming, compaction and direct relays. Only a CLI-backed 401 with a replayable body can refresh and replay once, and only with a different token. It does not retry successful/partially consumed streams, network failures, other provider authentication or non-401 statuses. It does not implement subscription pooling.

Keychain does not offer compare-and-swap through `security`: reread-before-write reduces external CLI races but is not a cross-process transaction. An independent CLI login/logout can still race the final store write. In-process removal is serialized against tracked writes; it does not coordinate unrelated operating-system processes.

## Hot deployment

Deploy the entire commit, not just the four cache functions: `accountCredentialExists` changed from sync to async and its login caller must await it. Generate runtime types, load the new helper first, then changed functions, and validate metadata/types. There are no route or migration changes.

```
procs.dev.genTypes({})
procs.repl.load({ name: "llm.fetchClaudeCode" })
```

Reload/validate `llm.refreshClaudeCode`, `llm.oauthEncryptionKey`, `llm.accountCredentialExists`, `llm.listAccounts`, `llm.accountRegistry`, `llm.startAccountLogin`, `llm.removeAccount`, `llm.saveAnthropicOAuth`, `llm.saveXaiOAuth`, `llm.logoutAnthropicOAuth`, `llm.logoutXaiOAuth`, `llm.refreshUsage`, `llm.call`, `llm.streamAnthropic`, `llm.compactAnthropic`, and `node.relay`. Hot reload preserves process state. Never restart an active service just to reload these functions; if live RPC is unavailable, arrange access or an explicitly approved idle restart.

Do not reset or regenerate an existing encryption key. Check decryption of existing ciphertext and an encryption round-trip without displaying plaintext. A new manual OAuth login remains a separate end-to-end confirmation. Protect and back up an existing file key outside the database; losing it loses the ability to decrypt the stored credentials.

## Validation and measurement

Mock tests cover concurrent reads, expiration, 401 recovery, stale 401s, refresh rotation with failed persistence, external rotation/deletion, unavailable Keychain, existing headless fallback, account mutation invalidation, and HTTP replay rules. Integration tests use an isolated database/registry and fake provider responses, not real credentials.

For system load, count distinct `(bootUUID, processID)` in `log show --predicate 'process == "security"'` over equal complete-minute intervals, with a leading guard minute. **Log lines are not process launches.** Unified logs are an observation, not a complete exec audit, and aggregate all users on the Mac. Compare the same method before/after; a reduction does not prove what caused an OS watchdog reboot.
