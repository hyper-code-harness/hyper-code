import { parseFragment, serialize } from 'parse5';

/**
 * Convert untrusted SVG into a bounded self-contained image data URL.
 *
 * Use for static chat diagrams, never inline DOM insertion. Strict SVG namespace, element and attribute allowlists remove scripts, animation, foreign content, styles and external resources. Accepts raw SVG or base64 SVG data URLs; returns null for invalid or oversized inputs. Input limit is 1 MiB, output limit 256 KiB; CSS-dependent diagrams lose styles.
 * @param opts.svg Raw SVG markup or a base64 image/svg+xml data URL to decode and sanitize again.
 */
export default function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Raw SVG markup or a base64 image/svg+xml data URL to decode and sanitize again. */
        svg: string;
    },
): string | null {
    if (opts.svg.length > 1048576) return null;
    let raw = opts.svg;
    if (raw.startsWith('data:')) {
        const prefix = 'data:image/svg+xml;base64,';
        if (!raw.startsWith(prefix)) return null;
        const encoded = raw.slice(prefix.length);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
        raw = Buffer.from(encoded, 'base64').toString('utf8');
    }
    const fragment = parseFragment(raw);
    const roots = fragment.childNodes.filter(n => n.nodeName !== '#text' || ('value' in n && n.value.trim()));
    const root = roots[0];
    if (roots.length !== 1 || !root || !('tagName' in root) || root.tagName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') return null;
    const tags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask pattern marker symbol use title desc'.split(' '));
    const attrs = new Set('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform preserveAspectRatio fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity font-family font-size font-weight font-style text-anchor dominant-baseline dx dy rotate textLength lengthAdjust offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform markerWidth markerHeight refX refY orient markerUnits clipPathUnits maskUnits maskContentUnits'.split(' '));
    const refs = new Set(['clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']);
    const local = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
    const paint = /^(?:none|currentColor|transparent|[a-zA-Z]+|#[0-9a-fA-F]{3,8}|rgba?\([0-9.,% ]+\)|hsla?\([0-9.,% ]+\)|url\(#[A-Za-z_][A-Za-z0-9_.:-]*\))$/;
    const queue = [{ node: root, depth: 0 }];
    let count = 0;
    while (queue.length) {
        const { node, depth } = queue.pop()!;
        if (depth > 128) return null;
        if (++count > 10000) return null;
        node.attrs = node.attrs.filter(a => {
            if (a.namespace || a.prefix) return false;
            if (a.name === 'href') return node.tagName === 'use' && local.test(a.value);
            if (refs.has(a.name)) return /^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/.test(a.value);
            if (!attrs.has(a.name)) return false;
            if (['fill', 'stroke', 'stop-color'].includes(a.name)) return paint.test(a.value);
            return !/[\\<>\u0000-\u001f]/.test(a.value) && !/url|javascript|data:|https?:|var\(/i.test(a.value);
        });
        node.childNodes = node.childNodes.filter(child => {
            if (child.nodeName === '#text') return true;
            if (!('tagName' in child) || child.namespaceURI !== 'http://www.w3.org/2000/svg' || !tags.has(child.tagName)) return false;
            queue.push({ node: child, depth: depth + 1 });
            return true;
        });
    }
    root.attrs.push({name:'xmlns',value:'http://www.w3.org/2000/svg'});
    const output = serialize(fragment).replace(/&nbsp;/g, '&#160;');
    if (Buffer.byteLength(output) > 262144) return null;
    return 'data:image/svg+xml;base64,' + Buffer.from(output).toString('base64');
}
