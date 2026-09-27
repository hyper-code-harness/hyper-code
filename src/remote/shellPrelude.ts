/**
 * Returns the bash prelude every remote command starts with: a PATH that includes user and Homebrew tool directories.
 *
 * Non-interactive login shells skip ~/.zshrc and ~/.bashrc, so bun, brew, cargo and docker are often missing from PATH over SSH. The prelude prepends ~/.bun/bin, ~/.local/bin, ~/.cargo/bin, /opt/homebrew/bin, /opt/homebrew/sbin and /usr/local/bin. Used by remote.exec and remote.start; use it when composing your own remote scripts.
 */
export default function (_ctx: Context, _session: Session | null, _opts: {}): string {
    return 'export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"\n';
}
