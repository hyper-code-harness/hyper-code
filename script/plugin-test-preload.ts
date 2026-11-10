// Preload of script/plugin-test.ts: provides `hyper:test` to a plugin's tests. testCtx() is Hyper's own test
// harness with the throwaway plugin host mounted, so the plugin under test (and what it requires) is in ctx.fns.
import { plugin } from "bun";
import { testCtx } from "../src/$test";

const host = process.env.HYPER_PLUGIN_TEST_HOST ?? "";

plugin({
    name: "hyper-test",
    setup(build) {
        build.module("hyper:test", () => ({
            loader: "object",
            exports: {
                testCtx: (opts: { env?: Record<string, string> } = {}) =>
                    testCtx({ ...opts, env: { ...opts.env, PLUGIN_HOST: host } }),
            },
        }));
    },
});
