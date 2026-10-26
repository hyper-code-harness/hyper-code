import { expect, test } from "bun:test";

test("popup host owns the complete file-preview presentation", async () => {
    const source = await Bun.file(new URL("./$script_popup.js", import.meta.url)).text();
    expect(source).toContain("content(html, title = '', kind = '')");
    expect(source).toContain("const file = kind === 'file-preview'");
    expect(source).toContain("dialog.style.height = file ? '97vh' :");
    expect(source).toContain("shell.style.height = file || jobs ? '100%' : ''");
    // the background-jobs modal is the other large kind
    expect(source).toContain("const jobs = kind === 'jobs'");
    expect(source).toContain("overflow-hidden bg-base-200 p-0");
});
