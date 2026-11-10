import { describe, test, expect } from 'bun:test';
import sanitizeHtmlBodyFn from './sanitizeHtmlBody';
import sanitizeSvgImage from './sanitizeSvgImage';
const ctx = { fns: { agent: { sanitizeSvgImage: (opts: {svg: string}) => sanitizeSvgImage(null as any, null, opts) } } } as unknown as Context;
const sanitizeHtmlBody = (html: string) => sanitizeHtmlBodyFn(ctx, null, { html });

describe('agent.sanitizeHtmlBody', () => {
    test('removes events, HTMX, styles and arbitrary attributes', () => {
        expect(sanitizeHtmlBody('<div ONCLICK="x()" hx-get="/delete" data-hx-post="/delete" style="color:red" id="app" class="p-2">ok</div>')).toBe('<div class="p-2">ok</div>');
    });
    test('rejects executable and obfuscated URLs', () => {
        for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', '&#106;avascript:alert(1)', 'vbscript:x', 'data:text/html,x']) {
            expect(sanitizeHtmlBody(`<a href="${href}">link</a>`)).toBe('<a rel="noopener noreferrer">link</a>');
        }
        expect(sanitizeHtmlBody('<img src="data:image/svg+xml,x" onerror="x()">')).toBe('<img>');
    });
    test('preserves links, tables and images', () => {
        expect(sanitizeHtmlBody('<a href="/docs" target="_blank">docs</a>')).toBe('<a href="/docs" target="_blank" rel="noopener noreferrer">docs</a>');
        expect(sanitizeHtmlBody('<table><tr><td colspan="2"><strong>B</strong></td></tr></table><img src="https://example.com/x" alt="x">')).toBe('<table><tbody><tr><td colspan="2"><strong>B</strong></td></tr></tbody></table><img src="https://example.com/x" alt="x">');
    });
    test('drops active and foreign elements with children', () => {
        expect(sanitizeHtmlBody('<iframe srcdoc="x">bad</iframe><object>bad</object><embed><form><input><button>bad</button></form><svg><a>bad</a></svg><math><mi>bad</mi></math><template><p>bad</p></template><!--bad--><p>ok</p>')).toContain('<p>ok</p>');
    });
    test('handles malformed HTML and remains stable on reparsing', () => {
        for (const input of ['<img src=x onerror=alert(1)//>', '<scrIpt>alert(1)', '<svg><style><img src=x onerror=alert(1)></style></svg>', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">', '<p><b>hello</p>world']) {
            const output = sanitizeHtmlBody(input);
            expect(output).not.toMatch(/onerror|<script|<svg|<math|<style/i);
            expect(sanitizeHtmlBody(output)).toBe(output);
        }
    });
    test('plain markup passes through unchanged', () => {
        expect(sanitizeHtmlBody('<div class="p-2">hi</div>')).toBe('<div class="p-2">hi</div>');
    });

    test('strips DOCTYPE', () => {
        expect(sanitizeHtmlBody('<!DOCTYPE html>\n<div>x</div>')).toBe('<div>x</div>');
    });

    test('strips html/body wrappers; <head> and <title> blocks (with content) are nuked', () => {
        const input = '<html><head><meta charset="utf-8"><title>t</title></head><body><p>real</p></body></html>';
        expect(sanitizeHtmlBody(input)).toBe('<p>real</p>');
    });

    test('removes <style> blocks entirely', () => {
        const input = '<style>body{margin:40px}</style><p>ok</p>';
        expect(sanitizeHtmlBody(input)).toBe('<p>ok</p>');
    });

    test('removes <script> blocks entirely', () => {
        const input = '<p>ok</p><script>alert(1)</script>';
        expect(sanitizeHtmlBody(input)).toBe('<p>ok</p>');
    });

    test('full Haiku-style document is reduced to inner markup', () => {
        const input = `<!DOCTYPE html>
<html>
<head><style>body{margin:40px auto}</style></head>
<body><div class="card">hi</div></body>
</html>`;
        expect(sanitizeHtmlBody(input)).toBe('<div class="card">hi</div>');
    });

    test('trims leading/trailing whitespace', () => {
        expect(sanitizeHtmlBody('   <p>x</p>   ')).toBe('<p>x</p>');
    });

    test('case-insensitive on tags', () => {
        expect(sanitizeHtmlBody('<HTML><BODY><P>x</P></BODY></HTML>')).toBe('<p>x</p>');
    });
});
