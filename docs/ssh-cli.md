# SSH instances for Codex CLI and Claude Code

This illustrative integration lets a local Hyper use **Codex CLI and Claude Code
subscription accounts on a remote Linux machine**, without installing Hyper there
or copying provider credentials locally. It complements SSH workspace tools and
Hyper nodes; it is not an arbitrary OpenAI endpoint proxy.

The official CLI performs login and writes isolated file credentials remotely.
For inference, Hyper sends a request over OpenSSH to an ephemeral Python 3 bridge.
That bridge reads and refreshes credentials, calls the provider's HTTPS endpoint,
and streams the response back to Hyper's existing Responses or Anthropic parser.
It does **not** start a CLI conversation for each prompt. The agent loop, transcript,
and tool execution remain local unless the workspace/tools are separately remote.

## Setup

1. Configure an OpenSSH host alias on the Hyper server using key authentication.
   Independently verify its host key and record it in OpenSSH `known_hosts`.
   Unknown or changed keys fail closed. Password prompts and agent forwarding are
   disabled. Connections do not reuse a potentially less-strict ControlMaster.
2. Install Python 3 and the desired official CLI on the remote Linux machine.
   Authenticate each provider you want to use in its own isolated directory.
   Run these commands **on that remote machine**, not on the Hyper server:

   ```sh
   # Codex CLI (ChatGPT subscription login, not an API key)
   mkdir -p "$HOME/.hyper/ssh-accounts/codex/default"
   chmod 700 "$HOME/.hyper/ssh-accounts/codex/default"
   env -u OPENAI_API_KEY -u CODEX_API_KEY -u CODEX_HOME \
     HOME="$HOME/.hyper/ssh-accounts/codex/default" codex login

   # Claude Code (subscription login, not an API key)
   mkdir -p "$HOME/.hyper/ssh-accounts/claude-code/default"
   chmod 700 "$HOME/.hyper/ssh-accounts/claude-code/default"
   env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
     -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CONFIG_DIR \
     HOME="$HOME/.hyper/ssh-accounts/claude-code/default" claude auth login
   ```

   Use file-backed credential storage: the bridge expects `.codex/auth.json` or
   `.claude/.credentials.json` beneath the corresponding isolated HOME. Keyring-
   or keychain-only storage is not supported. If credentials are not written there,
   configure the installed CLI's documented file-storage mode before proceeding.
   The bridge never falls back to the remote user's ordinary account directories
   or to local Hyper credentials. Remove any other environment overrides that make
   the installed CLI select a different authentication source or endpoint.
3. In **LLM connections → SSH instances → Configure SSH instances**, enable the
   alias. Alternatively, set `llm.sshCliHosts` to comma-separated aliases through
   the existing Settings system. Saving configuration does not log in, connect,
   or verify account health.
4. Select the appropriate route in the existing model picker:
   - `ssh-codex/<alias>:gpt-5.4`
   - `ssh-claude-code/<alias>:claude-sonnet-4-6`

   These are curated entries, not a remote catalogue or proof of entitlement.
   Other provider model IDs can be entered explicitly. Only select a provider
   whose isolated remote login has been completed.

## Security boundaries

- Owners and trusted internal agent/REPL calls may invoke the transport. An alias
  and its OpenSSH configuration (including `ProxyCommand`) are trusted
  administrator configuration, not a sandbox.
- Provider credentials stay on the remote host. Requests travel on stdin, not in
  process arguments. SSH stderr is suppressed to avoid credential-bearing
  tracebacks. Provider responses and generated content return to local Hyper.
- Only the fixed Codex Responses POST and Anthropic Messages POST endpoints are
  accepted for inference. Caller authentication, cookie, and host headers are
  stripped; authorization is injected remotely. Redirects are refused. Token
  refresh stays remote under a file lock with atomic credential replacement.
- Credential paths are checked for symlinks. The remote OS user and administrators
  can still access these files: isolated HOME is credential separation, **not**
  an OS security sandbox.
- Each provider uses one account named `default` per remote OS user. Multiple
  aliases or Hyper installations pointing at the same remote user share those
  directories; this example does not provide per-installation account isolation.

## Limits and failure behavior

- Manual remote CLI login only: no managed login flow, key creation, host-key
  approval UI, remote quota polling, or dynamic model discovery.
- Compaction is explicitly unsupported for both SSH routes; start a new chat.
  Local providers and Hyper-node transport remain separate.
- SSH requests are not automatically replayed, including failures before response
  headers: the provider may already have started generation. There is no stream
  resume, connection pool, or background daemon.
- Cancellation closes the local SSH subprocess. It does not guarantee immediate
  termination of every remote descendant or cancellation of provider-side work.
- The initial response-header deadline and remote HTTP socket timeout are each
  90 seconds; they are not an overall deadline for the entire generation.
- Live CLI authentication, token refresh, and inference require a trusted SSH
  server and real provider accounts. Mocked tests are not evidence that these
  live workflows have been verified. Treat this as reviewable example code, not
  a production authentication integration.

## Isolated tests (no application boot or database)

The normal upstream test preload may start integration services. To run just this
example plus the existing SSE regression tests, use a disposable local runner:

```bash
mkdir -p .hyper/tmp/ssh-cli-tests
printf '[test]\npreload = []\n' > .hyper/tmp/ssh-cli-tests/bunfig.toml
cat > .hyper/tmp/ssh-cli-tests/run.test.ts <<'TESTS'
import '../../../src/sshCli/transport.test.ts';
import '../../../src/sshCli/process.it.test.ts';
import '../../../src/llm/parseSSE.test.ts';
TESTS
(cd .hyper/tmp/ssh-cli-tests && set -o pipefail && bun test ./run.test.ts 2>&1 | cat)
```

Requires Bun and Python 3. Tests use stubs and local subprocesses only: neither a
real SSH host nor a real provider account is contacted. They cover both protocol
parsers, CLI identity/headers, no local credential access, explicit compaction
failure, malformed/early EOF cleanup, a 2 MB stdin payload, subprocess failure,
abort/cancel, and remote header injection with fake Python HTTP. They **do not**
exercise real OAuth refresh, TLS, host-key rotation, or live CLI login.
