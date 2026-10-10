/**
 * Lay out a nested block tree as absolute SVG boxes using Yoga flexbox
 *
 * Use for nested rows, columns and wrapping groups with explicit pixel sizes. Returns containers and leaves by ID in root-relative coordinates, plus overflow-inclusive bounds. Defaults: column, stretch alignment, start justification, no wrapping, zero gap/padding/grow/shrink, LTR, no pixel rounding. Root depth is 1; at most 64 levels and 1000 nodes. Empty root null returns zero bounds. No CSS grid, text measurement, SVG rendering or edge routing; measure text separately and supply dimensions.
 * @param opts.root Unique-ID block tree; null represents an empty layout. Dimensions and spacing are finite pixels from 0 to 1000000.
 * @param opts.width Override root width in pixels; omitted uses root width or intrinsic sizing. @minimum 0 @maximum 1000000
 * @param opts.height Override root height in pixels; omitted uses root height or intrinsic sizing. @minimum 0 @maximum 1000000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique-ID block tree; null represents an empty layout. Dimensions and spacing are finite pixels from 0 to 1000000. */
        root: types.svg.FlexNode | null;
        /** Override root width in pixels; omitted uses root width or intrinsic sizing. @minimum 0 @maximum 1000000 */
        width?: number;
        /** Override root height in pixels; omitted uses root height or intrinsic sizing. @minimum 0 @maximum 1000000 */
        height?: number;
    },
): Promise<types.svg.FlexLayoutResult> {
    const number = (value: number | undefined, label: string) => {
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)) throw new Error(`${label} must be finite and between 0 and 1000000`);
    };
    number(opts.width, 'width'); number(opts.height, 'height');
    const ids = new Set<string>();
    const numeric = ['width','height','minWidth','minHeight','maxWidth','maxHeight','gap','grow','shrink'] as const;
    const allowed = new Set(['id','children','direction','padding','align','justify','wrap', ...numeric]);
    const check = (n: types.svg.FlexNode, depth: number) => {
        if (depth > 64 || ids.size >= 1000) throw new Error('Flex tree limit: 1000 nodes and 64 levels');
        if (!n || typeof n !== 'object' || Array.isArray(n)) throw new Error('Each node must be an object');
        if (typeof n.id !== 'string' || !n.id.trim() || ids.has(n.id)) throw new Error('Node IDs must be nonempty and unique');
        ids.add(n.id);
        for (const key of Object.keys(n)) if (!allowed.has(key)) throw new Error(`Unsupported flex field: ${key}`);
        for (const key of numeric) number(n[key], `${n.id}.${key}`);
        for (const axis of ['Width','Height'] as const) if (n[`min${axis}`] !== undefined && n[`max${axis}`] !== undefined && n[`min${axis}`]! > n[`max${axis}`]!) throw new Error(`min${axis} exceeds max${axis}`);
        const enums = {direction:['row','column'],align:['start','center','end','stretch'],justify:['start','center','end','space-between','space-around','space-evenly']} as const;
        for (const key of ['direction','align','justify'] as const) if (n[key] !== undefined && !(enums[key] as readonly string[]).includes(n[key]!)) throw new Error(`Invalid ${key}`);
        if (n.wrap !== undefined && typeof n.wrap !== 'boolean') throw new Error('wrap must be boolean');
        if (n.padding !== undefined) {
            if (typeof n.padding === 'number') number(n.padding, 'padding');
            else {
                if (!n.padding || typeof n.padding !== 'object' || Array.isArray(n.padding)) throw new Error('Invalid padding');
                for (const [key, value] of Object.entries(n.padding)) {
                    if (!['top','right','bottom','left'].includes(key)) throw new Error(`Invalid padding edge: ${key}`);
                    number(value, `padding.${key}`);
                }
            }
        }
        if (n.children !== undefined && !Array.isArray(n.children)) throw new Error('children must be an array');
        for (const child of n.children ?? []) check(child, depth + 1);
    };
    if (opts.root !== null) check(opts.root, 1);
    const boxes: types.svg.FlexLayoutResult['boxes'] = Object.create(null);
    const order: string[] = [];
    if (opts.root === null) return {boxes, order, bounds:{x:0,y:0,width:0,height:0}};
    // Package ESM initializes its bundled WASM once; every call owns its nodes/config.
    // Hot-reloaded dynamic imports otherwise resolve from the runtime loader, not this plugin.
    const {resolve} = await import('node:path');
    const {default: Y} = await import(resolve(import.meta.dir, '../../node_modules/yoga-layout/dist/src/index.js')) as typeof import('yoga-layout');
    const config = Y.Config.create();
    config.setPointScaleFactor(0);
    let root: ReturnType<typeof Y.Node.create> | undefined;
    try {
        root = Y.Node.create(config);
        const align = {start:Y.ALIGN_FLEX_START,center:Y.ALIGN_CENTER,end:Y.ALIGN_FLEX_END,stretch:Y.ALIGN_STRETCH};
        const justify = {start:Y.JUSTIFY_FLEX_START,center:Y.JUSTIFY_CENTER,end:Y.JUSTIFY_FLEX_END,'space-between':Y.JUSTIFY_SPACE_BETWEEN,'space-around':Y.JUSTIFY_SPACE_AROUND,'space-evenly':Y.JUSTIFY_SPACE_EVENLY};
        const build = (n: types.svg.FlexNode, y: NonNullable<typeof root>, isRoot: boolean) => {
            y.setFlexDirection(n.direction === 'row' ? Y.FLEX_DIRECTION_ROW : Y.FLEX_DIRECTION_COLUMN);
            y.setAlignItems(align[n.align ?? 'stretch']); y.setAlignContent(Y.ALIGN_FLEX_START);
            y.setJustifyContent(justify[n.justify ?? 'start']);
            y.setFlexWrap(n.wrap ? Y.WRAP_WRAP : Y.WRAP_NO_WRAP);
            y.setFlexGrow(n.grow ?? 0); y.setFlexShrink(n.shrink ?? 0);
            y.setGap(Y.GUTTER_ALL, n.gap ?? 0);
            const width = isRoot ? opts.width ?? n.width : n.width;
            const height = isRoot ? opts.height ?? n.height : n.height;
            if (width !== undefined) y.setWidth(width);
            if (height !== undefined) y.setHeight(height);
            if (n.minWidth !== undefined) y.setMinWidth(n.minWidth);
            if (n.maxWidth !== undefined) y.setMaxWidth(n.maxWidth);
            if (n.minHeight !== undefined) y.setMinHeight(n.minHeight);
            if (n.maxHeight !== undefined) y.setMaxHeight(n.maxHeight);
            if (typeof n.padding === 'number') y.setPadding(Y.EDGE_ALL, n.padding);
            else if (n.padding) for (const [key, edge] of Object.entries({top:Y.EDGE_TOP,right:Y.EDGE_RIGHT,bottom:Y.EDGE_BOTTOM,left:Y.EDGE_LEFT})) y.setPadding(edge, n.padding[key as keyof typeof n.padding] ?? 0);
            for (const child of n.children ?? []) {
                const c = Y.Node.create(config);
                // Attach before applying styles so subsequent failures are covered by freeRecursive.
                try { y.insertChild(c, y.getChildCount()); } catch (error) { c.free(); throw error; }
                build(child, c, false);
            }
        };
        build(opts.root, root, true);
        root.calculateLayout(undefined, undefined, Y.DIRECTION_LTR);
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        const collect = (n: types.svg.FlexNode, y: NonNullable<typeof root>, px: number, py: number) => {
            const b = y.getComputedLayout();
            const box = {x:px+b.left,y:py+b.top,width:b.width,height:b.height};
            if (!Object.values(box).every(Number.isFinite)) throw new Error('Non-finite Yoga output');
            boxes[n.id] = box; order.push(n.id);
            minX = Math.min(minX,box.x); minY = Math.min(minY,box.y);
            maxX = Math.max(maxX,box.x+box.width); maxY = Math.max(maxY,box.y+box.height);
            for (const [i,child] of (n.children ?? []).entries()) collect(child,y.getChild(i),box.x,box.y);
        };
        collect(opts.root, root, 0, 0);
        return {boxes,order,bounds:{x:minX,y:minY,width:maxX-minX,height:maxY-minY}};
    } finally {
        root?.freeRecursive();
        config.free();
    }
}
