// The JSX factory. `svg.tsx` transpiles a fence with `jsxFactory: "__svgElement"`
// and binds that name to this function, so <rect x={10}/> becomes markup instead
// of a React element — there is no virtual DOM here and nothing to reconcile.
// The name is deliberately ugly: `h` is what anyone drawing calls a height, and
// a shadowed factory fails with "h is not a function" halfway through.
//
// Three rules do all the work of making JSX feel right in SVG:
//   * camelCase attributes become hyphenated (fontSize → font-size), EXCEPT the
//     handful SVG itself spells in camelCase. Getting this backwards is how you
//     get an invisible drawing: `view-box` is not `viewBox` and is ignored.
//   * a child that is null, false or undefined disappears, so `cond && <g/>`
//     and `rows.map(...)` work the way they do in React.
//   * a child element arrives as a Node and is inserted as is; anything else is
//     a value a human computed and is escaped. That distinction is why this
//     returns a Node instead of a bare string — markup and text that happens to
//     contain "<" are not the same thing and cannot be told apart by looking.

/** SVG attributes that are genuinely camelCase and must not be hyphenated. */
const CAMEL = new Set([
    "viewBox", "preserveAspectRatio", "baseProfile", "clipPath", "clipPathUnits", "patternUnits",
    "patternContentUnits", "patternTransform", "gradientUnits", "gradientTransform", "spreadMethod",
    "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "textLength", "lengthAdjust",
    "startOffset", "pathLength", "maskUnits", "maskContentUnits", "primitiveUnits", "filterUnits",
    "stdDeviation", "baseFrequency", "numOctaves", "tableValues", "surfaceScale", "specularConstant",
    "specularExponent", "diffuseConstant", "kernelMatrix", "requiredExtensions", "systemLanguage",
    "attributeName", "repeatCount", "keyTimes", "keySplines", "calcMode",
]);

/** Elements written as `<rect/>` when they have no children. XML allows this
 * for any element, but keeping <g></g> and <text></text> paired matches what a
 * person expects to read in the output. */
const VOID = new Set(["path", "rect", "circle", "line", "polyline", "polygon", "ellipse", "use", "image", "stop",
    "feGaussianBlur", "feOffset", "feFlood", "feComposite", "feColorMatrix", "feBlend", "feDropShadow"]);


const escapeText = (value: unknown) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: unknown) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function attrName(key: string): string {
    if (key === "className") return "class";
    if (key === "xmlnsXlink") return "xmlns:xlink";
    if (/^xlink[A-Z]/.test(key)) return "xlink:" + key[5]!.toLowerCase() + key.slice(6);
    if (CAMEL.has(key)) return key;
    return key.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
}

/** Inline style written as an object, the way JSX users expect. */
function styleValue(value: Record<string, unknown>): string {
    return Object.entries(value)
        .filter(([, v]) => v != null && v !== false)
        .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v}`)
        .join(";");
}

/**
 * Builds one SVG element as markup; the JSX factory behind ```svg tsx fences.
 *
 * Call it to assemble a drawing from code without JSX syntax, or let svg.tsx
 * bind it as the JSX factory. Attribute names are translated from JSX spelling to SVG
 * spelling (fontSize → font-size, viewBox kept as is, className → class, a
 * `style` object serialized); null, false and undefined attributes and children
 * are dropped; text children are escaped while nested elements are not.
 * @param opts.tag Element name, such as "svg", "g", "rect" or "text".
 * @param opts.props Attributes in JSX spelling; `style` may be an object, `children` is accepted here too.
 * @param opts.children Children: elements, text, numbers, or nested arrays of them.
 * @returns The element as a node carrying its markup.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Element name, such as "svg", "g", "rect" or "text". */
    tag: string;
    /** Attributes in JSX spelling; `style` may be an object, `children` is accepted here too. */
    props?: Record<string, unknown> | null;
    /** Children: elements, text, numbers, or nested arrays of them. */
    children?: unknown;
}): types.svg.Node {
    const tag = String(opts.tag ?? "").trim();
    if (!/^[A-Za-z][A-Za-z0-9:-]*$/.test(tag)) throw new Error(`svg: not an element name: ${opts.tag}`);

    let attrs = "";
    for (const [key, value] of Object.entries(opts.props ?? {})) {
        if (value == null || value === false || key === "children" || key === "dangerouslySetInnerHTML") continue;
        if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(key)) throw new Error(`svg: not an attribute name: ${key}`);
        const text = key === "style" && value && typeof value === "object" ? styleValue(value as Record<string, unknown>) : value;
        // A bare `fill` is not a thing in SVG, but `true` reads as "on".
        attrs += ` ${attrName(key)}="${escapeAttr(text === true ? key : text)}"`;
    }

    const parts: string[] = [];
    const push = (child: unknown) => {
        if (child == null || child === false || child === true) return;
        if (Array.isArray(child)) { for (const item of child) push(item); return; }
        if (child && typeof child === "object" && typeof (child as any).markup === "string") { parts.push((child as any).markup); return; }
        parts.push(escapeText(child));
    };
    push((opts.props as any)?.children);
    push(opts.children);

    const body = parts.join("");
    return { markup: VOID.has(tag) && !body ? `<${tag}${attrs}/>` : `<${tag}${attrs}>${body}</${tag}>` };
}
