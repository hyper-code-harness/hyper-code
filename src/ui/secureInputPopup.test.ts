import { expect, test } from 'bun:test';

test('popup script owns secure-input cancellation and has no duplicate target declaration', async () => {
    const source = await Bun.file(new URL('./$script_popup.js', import.meta.url)).text();
    expect(source).toContain("dataset.popupKind === 'secure-input'");
    expect(source).toContain("[data-secure-cancel]");
    expect(source).toContain("addEventListener('cancel'");
    expect(source).toContain("getElementById('app-popup-close')");
    expect(source).not.toContain('secureInputReturnFocus');
});

test('secure-input submit does not replace the prompt with an empty loading popup', async () => {
    const source = await Bun.file(new URL('./$script_rpc.js', import.meta.url)).text();
    expect(source).toContain("method === 'secureInput.submit'");
    // Submit and the pending-prompt check are quiet: no loading dialog replaces the prompt.
    expect(source).toContain('const quiet = secureSubmit');
    expect(source).toContain('if (!quiet) window.hyperPopup?.loading');
});
