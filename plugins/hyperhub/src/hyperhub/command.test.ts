import { afterEach, describe, expect, test } from 'bun:test';
import command from './command';
const originalSpawn = Bun.spawn;
const originalKill = process.kill;
const originalTimeout = globalThis.setTimeout;
afterEach(() => { Bun.spawn = originalSpawn; process.kill = originalKill; globalThis.setTimeout = originalTimeout; });
const ctx = {} as Context;
const options = { dir: '/tmp', args: ['status'] };
function mock(out: ReadableStream<Uint8Array>, err = new Blob(['']).stream(), code: Promise<number> = Promise.resolve(0), exitCode: number | null = null) {
  const signals: string[] = [];
  process.kill = ((pid: number, signal: string) => { expect(pid).toBe(-12345); signals.push(signal); return true; }) as typeof process.kill;
  Bun.spawn = ((argv: string[], opts: Record<string, unknown>) => {
    expect(argv.slice(0,3)).toEqual(['git','-c','core.hooksPath=/dev/null']);
    expect(opts.detached).toBe(true);
    return { exitCode, pid: 12345, stdout: out, stderr: err, exited: code, kill: () => {} };
  }) as typeof Bun.spawn;
  return signals;
}
describe('hyperhub.command', () => {
  test('preserves NUL-delimited output without signalling a reaped process', async () => {
    const signals = mock(new Blob(['file one\0file two\0']).stream(), undefined, Promise.resolve(0), 0);
    expect(await command(ctx,null,options)).toBe('file one\0file two\0');
    expect(signals).toEqual([]);
  });
  test('ignores ESRCH during cleanup', async () => {
    mock(new Blob(['ok']).stream());
    process.kill = (() => { throw Object.assign(new Error('already gone'), {code:'ESRCH'}); }) as typeof process.kill;
    expect(await command(ctx,null,options)).toBe('ok');
  });
  test('rejects stdout cap and cancels endless output', async () => {
    let cancelled = false;
    const signals = mock(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(4_000_001)); }, cancel() { cancelled=true; } }));
    await expect(command(ctx,null,options)).rejects.toThrow('output exceeds');
    expect(cancelled).toBe(true);
    expect(signals).toContain('SIGKILL');
  });
  test('stderr is capped too', async () => {
    mock(new Blob(['']).stream(),new Blob([new Uint8Array(1_000_001)]).stream());
    await expect(command(ctx,null,options)).rejects.toThrow('output exceeds');
  });
  test('remote error credentials never appear in thrown message', async () => {
    mock(new Blob(['']).stream(),new Blob(['https://user:secret@host/?token=other']).stream(),Promise.resolve(128));
    try { await command(ctx,null,options); throw Error('unexpected success'); }
    catch(error) { expect(String(error)).toContain('Git failed (128)'); expect(String(error)).not.toContain('secret@'); expect(String(error)).not.toContain('token='); }
  });
  test('deadline interrupts stalled output and kills process group', async () => {
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => { expect(ms).toBe(60_000); return originalTimeout(fn,20,...args); }) as typeof setTimeout;
    let cancelled = false;
    const signals = mock(new ReadableStream({ cancel() { cancelled=true; } }),new Blob(['']).stream(),new Promise(() => {}));
    await expect(command(ctx,null,options)).rejects.toThrow('timed out');
    expect(signals).toContain('SIGKILL'); expect(cancelled).toBe(true);
  });
});
