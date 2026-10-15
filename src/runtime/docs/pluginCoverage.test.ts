import { test, expect } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });   // official plugins only, not this machine's user plugins

test("every mounted plugin function exposes docs and a parameter schema", () => {
    const seen = new Set<string>();
    const modules = ctx.fns.procs.modules.list({}).filter((item: any) => item.plugin);
    for (const module of modules as any[]) {
        // A module can be mounted through aliases; validate each source tree once.
        if (seen.has(module.dir)) continue;
        seen.add(module.dir);
        for (const name of [...new Set(module.fns)] as string[]) {
            const meta = ctx.fns.runtime.docs.get({ name });
            expect(meta.summary || meta.doc, `${name}: missing function documentation`).toBeTruthy();
            expect(meta.paramsSchema?.properties, `${name}: missing parameter schema`).toBeDefined();
        }
    }
});
