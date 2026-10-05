import { expect, test } from 'bun:test';
import render from './planTaskRow';
import { renderCtx } from './testRender.entry';

const ctx = await renderCtx();

test('plan task row uses ordinary repeated form fields', () => {
    const html = render(ctx, null, { task: { id: 't1', title: 'Build', instructions: 'Do it', status: 'pending', elapsedMs: 0 } });
    expect(html).toContain('name="task_id" value="t1"');
    expect(html).toContain('name="task_title"');
    expect(html).toContain('name="task_instructions"');
    expect(html).toContain('data-plan-remove');
});
