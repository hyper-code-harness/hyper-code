import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';

/**
 * Sanitize untrusted chat HTML with an HTML5 parser and a strict formatting allowlist.
 * Use before inserting model-generated fragments into the chat DOM. Removes active
 * content, foreign namespaces, event/HTMX attributes, inline styles and unsafe URLs.
 * Static SVG is converted to a separately sanitized data-URL image, never inline DOM.
 * Safe links, images, tables and text formatting are retained; document wrappers
 * are normalized by the parser. Output is canonical HTML, not source-preserving.
 * @param opts.html Untrusted HTML fragment or full document to sanitize for display.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Untrusted HTML fragment or full document; no scripts or interactive controls are retained. */
    html: string;
}): string {
    const allowed = new Set([
        'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'code',
        'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
        'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav',
        'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong',
        'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'time',
        'tr', 'tfoot', 'u', 'ul', 'var', 'wbr',
    ]);
    const globalAttrs = new Set(['class', 'title', 'lang', 'dir', 'role', 'aria-label', 'aria-hidden']);
    const tagAttrs: Record<string, string[]> = {
        a: ['href', 'target'], img: ['src', 'alt', 'width', 'height'],
        td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
        col: ['span'], colgroup: ['span'], ol: ['start', 'reversed', 'type'],
        li: ['value'], details: ['open'], time: ['datetime'],
    };
    const safeUrl = (value: string, image: boolean): boolean => {
        // HTML entities have already been decoded by parse5. Reject embedded URL
        // whitespace/control characters rather than relying on browser normalization.
        if (/[\u0000-\u0020\u007f-\u009f]/u.test(value)) return false;
        try {
            const url = new URL(value, 'https://sanitizer.invalid/');
            return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:', 'tel:']).includes(url.protocol);
        } catch {
            return false;
        }
    };
    const fragment = parseFragment(opts.html);
    const pending: Array<DefaultTreeAdapterMap['documentFragment'] | DefaultTreeAdapterMap['element']> = [fragment];
    while (pending.length) {
        const parent = pending.pop()!;
        parent.childNodes = parent.childNodes.map(node => {
            if (!('tagName' in node)) return node;
            const svg = node.namespaceURI === 'http://www.w3.org/2000/svg' && node.tagName === 'svg'
                ? serializeOuter(node)
                : node.tagName === 'img' ? node.attrs.find(a => a.name === 'src' && a.value.startsWith('data:'))?.value : undefined;
            if (!svg) return node;
            const src = ctx.fns.agent.sanitizeSvgImage({ svg });
            if (!src && node.tagName === 'img') {
                node.attrs = node.attrs.filter(a => a.name !== 'src');
                return node;
            }
            const image = parseFragment(src ? '<img alt="Diagram" src="' + src + '">' : '').childNodes[0];
            if (image) image.parentNode = parent;
            return image;
        }).filter((node): node is DefaultTreeAdapterMap['childNode'] => !!node).filter(node => {
            if (node.nodeName === '#text') return true;
            if (!('tagName' in node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !allowed.has(node.tagName)) return false;
            node.attrs = node.attrs.filter(attr => {
                if (attr.namespace || attr.prefix) return false;
                if (!globalAttrs.has(attr.name) && !tagAttrs[node.tagName]?.includes(attr.name)) return false;
                if (attr.name === 'src' && attr.value.startsWith('data:image/svg+xml;base64,')) return true; // Re-sanitized in the mapping pass above.
                if (attr.name === 'href' || attr.name === 'src') return safeUrl(attr.value, attr.name === 'src');
                if (attr.name === 'target') return attr.value === '_blank' || attr.value === '_self';
                return true;
            });
            if (node.tagName === 'a') node.attrs.push({ name: 'rel', value: 'noopener noreferrer' });
            pending.push(node);
            return true;
        });
    }
    return serialize(fragment).trim();
}
