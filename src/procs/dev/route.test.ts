// The url is the input and the file is the output — the whole point being that
// nobody has to remember the grammar in the other direction.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../../$test";

const ctx = await testCtx();

function project() {
    const dir = mkdtempSync(join(tmpdir(), "route-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    return { dir, run: ctx.fns.procs.env.fork({ mode: "test", env: { ...ctx.env, WORKDIR: dir } }) };
}

test("a url becomes the folders it is, with :params as $folders", async () => {
    const { dir, run } = project();
    const made = await run.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary" });

    expect(made.file).toBe("src/ehr/patient/$id/cardio/summary/$route__GET.ts");
    const source = await Bun.file(join(dir, made.file)).text();
    expect(source).toContain("GET /ehr/patient/:id/cardio/summary");
    expect(source).toContain("ctx.fns.w.page");

    // …and the POST beside it is the same address with its own file.
    const posted = await run.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary", method: "post" });
    expect(posted.file).toBe("src/ehr/patient/$id/cardio/summary/$route__POST.ts");
    expect(await Bun.file(join(dir, posted.file)).text()).toContain("answer with the fragment you changed");
});

test("it refuses what it cannot write, and what already answers", async () => {
    const { run } = project();
    await expect(run.fns.procs.dev.route({ url: "ehr/summary" })).rejects.toThrow(/must start with/);
    await expect(run.fns.procs.dev.route({ url: "/ehr/summary?tab=1" })).rejects.toThrow(/query/);
    await expect(run.fns.procs.dev.route({ url: "/ehr/sum mary" })).rejects.toThrow(/not a path segment/);
    await expect(run.fns.procs.dev.route({ url: "/" })).rejects.toThrow(/root route/);

    await run.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary" });
    await expect(run.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary" })).rejects.toThrow(/already/);

    // An address the process itself serves is not free either — the framework's
    // own, in this bare ctx.
    await expect(run.fns.procs.dev.route({ url: "/procs/modules" })).rejects.toThrow(/already answers/);
});
