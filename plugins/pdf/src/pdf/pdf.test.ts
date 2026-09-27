import { expect, test } from "bun:test";
import { testCtx } from "../../../../src/$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

test("litBin resolves an executable path or reports absence", async () => {
    const resolved = await ctx.fns.pdf.litBin({});
    expect(resolved === null || resolved.endsWith("/lit")).toBe(true);
});

test("needsOcr reports a missing input instead of throwing", async () => {
    const result = await ctx.fns.pdf.needsOcr({ input: "/tmp/pdf-plugin-missing-input.pdf" });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe("unknown");
    expect(result.pageCount).toBe(0);
    expect(String(result.error)).toMatch(/not found|not be found|lit/i);
});

test("parseLite reports a missing input instead of throwing", async () => {
    const result = await ctx.fns.pdf.parseLite({ input: "/tmp/pdf-plugin-missing-input.pdf" });
    expect(result.ok).toBe(false);
    expect(result.characters).toBe(0);
    expect(String(result.error)).toMatch(/not found|not be found|lit/i);
});

test("status exposes both heavy engines and the routing policy", async () => {
    const status = await ctx.fns.pdf.status({});
    expect(status.policy.length).toBeGreaterThan(0);
    expect(status.policy.every(entry => entry.engine === "marker" || entry.engine === "mineru")).toBe(true);
});

test("complexity probe and lite parse agree on a generated text PDF", async () => {
    const bin = await ctx.fns.pdf.litBin({});
    if (!bin) return; // LiteParse CLI is optional on this machine
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "pdf-plugin-"));
    const input = join(dir, "hello.pdf");
    const body = "BT /F1 24 Tf 72 700 Td (Liteparse plugin smoke test document) Tj ET";
    const objects = [
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj",
        `4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj`,
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const object of objects) { offsets.push(pdf.length); pdf += `${object}\n`; }
    const startxref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
    writeFileSync(input, pdf, "latin1");
    try {
        const probe = await ctx.fns.pdf.needsOcr({ input });
        expect(probe.ok).toBe(true);
        expect(probe.pageCount).toBe(1);
        expect(probe.pages[0]!.page).toBe(1);
        expect(probe.verdict === "SIMPLE" || probe.verdict === "COMPLEX").toBe(true);
        const parsed = await ctx.fns.pdf.parseLite({ input, outputDir: join(dir, "out") });
        expect(parsed.ok).toBe(true);
        expect(parsed.ocrUsed).toBe(false);
        expect(parsed.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
        const text = await Bun.file(parsed.outputPath).text();
        expect(text).toContain("Liteparse plugin smoke test");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
