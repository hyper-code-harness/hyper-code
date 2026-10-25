import { expect, test } from 'bun:test';
import content from './popupContent';
const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;') } }, w: { escape: ({ text }: any) => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;') } } };

test('popup helpers share the permanent host contract', () => {
    expect(content(ctx, null, { title: 'A', kind: 'tool', html: '<b>x</b>' })).toContain('data-popup-kind="tool"');
});
