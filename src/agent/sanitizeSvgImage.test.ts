import { test, expect } from 'bun:test';
import sanitize from './sanitizeSvgImage';
import sanitizeHtml from './sanitizeHtmlBody';
import { parseFragment } from 'parse5';
const clean = (svg: string) => sanitize(null as any, null, { svg });
const decode = (url: string) => Buffer.from(url.split(',')[1]!, 'base64').toString();
const ctx = { fns: { agent: { sanitizeSvgImage: ({svg}: {svg: string}) => clean(svg) } } } as unknown as Context;

test('SVG drawing survives in image context and repeated sanitization is stable', () => {
    const svg = '<svg viewBox="0 0 10 10"><defs><marker id="arrow"><path d="M0 0L1 1"/></marker></defs><path d="M0 0L9 9" stroke="red" marker-end="url(#arrow)"/><text x="1">Hi</text></svg>';
    const url = clean(svg)!;
    expect(decode(url)).toContain('marker-end="url(#arrow)"');
    expect(clean(url)).toBe(url);
    const html = sanitizeHtml(ctx, null, {html: svg});
    expect(html).toStartWith('<img alt="Diagram" src="data:image/svg+xml;base64,');
    expect(sanitizeHtml(ctx, null, {html})).toBe(html);
    expect(parseFragment(html).childNodes.length).toBe(1);
});

test('drops external resources, styles, active and foreign content', () => {
    const url = clean('<svg><style>@import "https://evil";</style><foreignObject><p>bad</p></foreignObject><script>x()</script><animate/><image href="https://evil"/><use href="https://evil"/><use href="#local"/><path onload="x()" hx-get="/delete" style="fill:red" fill="url(https://evil)" stroke="var(--x)"/><text>safe</text></svg>')!;
    const svg = decode(url);
    expect(svg).not.toMatch(/evil|foreignObject|script|animate|<image|style|onload|hx-get|var\(/);
    expect(svg).toContain('href="#local"');
    expect(svg).toContain('<text>safe</text>');
    expect(clean(url)).toBe(url);
});

test('mutation payloads cannot create active HTML and data input is re-sanitized', () => {
    for (const svg of ['<svg><desc><img src=x onerror=alert(1)></desc></svg>', '<svg><foreignObject><math><mtext><img src=x onerror=alert(1)></mtext></math></foreignObject></svg>', '<svg><style><img src=x onerror=alert(1)></style></svg>', '<svg><use href="&#106;avascript:alert(1)"/><text>&lt;img onerror=x&gt;</text></svg>']) {
        const input = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
        const url = clean(input);
        if (url) {
            const parsed = parseFragment(decode(url));
            expect(parsed.childNodes.length).toBe(1);
            expect(decode(url)).not.toMatch(/<(?:img|script|foreignObject|style|math)\b/);
            expect(clean(url)).toBe(url);
        }
        const html = sanitizeHtml(ctx, null, {html: '<img src="'+input+'">'});
        expect(html).not.toContain('<svg');
    }
});

test('caps and unsupported data formats fail closed', () => {
    expect(clean('x'.repeat(1048577))).toBeNull();
    expect(clean('<svg><text>'+'x'.repeat(262144)+'</text></svg>')).toBeNull();
    expect(clean('data:image/svg+xml,%3Csvg%3E')).toBeNull();
    expect(clean('data:image/svg+xml;base64,!!!!')).toBeNull();
    expect(clean('<svg></svg><img src=x>')).toBeNull();
});

test('real Mermaid and Vega-Lite renderer fixtures retain drawings as stable images', async () => {
    const fixtures = await Bun.file(new URL('./sanitizeSvgImage.fixtures.json', import.meta.url)).json() as Array<{name: string; html: string}>;
    for (const fixture of fixtures) {
        const html = sanitizeHtml(ctx, null, {html: fixture.html});
        const src = /src="(data:image\/svg\+xml;base64,[^"]+)"/.exec(html)?.[1];
        expect(src).toBeDefined();
        const svg = decode(src!);
        expect(svg).toMatch(/<(path|rect|polyline)\b/);
        expect(svg).toContain('<text');
        expect(svg).not.toMatch(/<style|<script|foreignObject|style=/);
        expect(sanitizeHtml(ctx, null, {html})).toBe(html);
    }
});

