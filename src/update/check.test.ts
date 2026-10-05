import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

test("update.check distinguishes current, behind and dirty checkouts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyper-update-"));
  const bare = join(dir, "remote.git"), seed = join(dir, "seed"), app = join(dir, "app");
  git(dir, "init", "--bare", bare); git(dir, "init", "-b", "main", seed);
  git(seed, "config", "user.email", "test@example.test"); git(seed, "config", "user.name", "Test");
  await writeFile(join(seed, "a.txt"), "one\n"); git(seed, "add", "."); git(seed, "commit", "-m", "one"); git(seed, "remote", "add", "origin", bare); git(seed, "push", "-u", "origin", "main");
  git(dir, "clone", "-b", "main", bare, app);
  const ctx: any = await mkTestCtx(); ctx.state.root = app;
  expect((await ctx.fns.update.check({ fetch: true })).state).toBe("current");
  await writeFile(join(seed, "a.txt"), "two\n"); git(seed, "commit", "-am", "two"); git(seed, "push");
  expect((await ctx.fns.update.check({ fetch: true })).state).toBe("available");
  await writeFile(join(app, "local.txt"), "dirty\n");
  expect((await ctx.fns.update.check({ fetch: false })).state).toBe("dirty");
});
