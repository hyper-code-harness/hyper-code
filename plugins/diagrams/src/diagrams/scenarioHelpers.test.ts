import { describe, expect, test } from 'bun:test';
import scenarioHelpers from './scenarioHelpers';
import scenarioValidate from './scenarioValidate';
import scenarioDiagram from './scenarioDiagram';
import sequenceDiagram from './sequenceDiagram';

const ctx = { fns: { diagrams: {
    scenarioValidate: (opts: { model: types.diagrams.Scenario }) => scenarioValidate(ctx, null, opts),
    sequenceDiagram: (opts: Parameters<typeof sequenceDiagram>[2]) => sequenceDiagram(ctx, null, opts),
} } } as Context;
const helpers = () => scenarioHelpers(ctx, null, {});

describe('synchronous typed scenario helpers', () => {
    test('all step kinds share an automatic counter and serialize actor handles synchronously', async () => {
        const h = await helpers();
        const a = h.actor('app', 'Application'), b = h.actor('auth', 'Authorization');
        expect(a).toEqual({ id: 'app', label: 'Application' });
        let n = 0;
        for (const kind of ['request', 'reply', 'send', 'redirect'] as const) {
            const step = h[kind](a, b, kind);
            expect(step).not.toBeInstanceOf(Promise);
            expect(step).toEqual({ type: 'message', id: `step-${++n}`, from: 'app', to: 'auth', label: kind, kind });
            expect(JSON.parse(JSON.stringify(step))).toEqual(step);
        }
        expect(h.action(a, 'Prepare')).toEqual({ type: 'action', id: 'step-5', actor: 'app', label: 'Prepare' });
        const steps = [h.request(a, b, 'Request')];
        const phase = h.phase('Phase', steps);
        expect(phase).toEqual({ type: 'phase', id: 'step-7', title: 'Phase', steps });
        expect(phase.steps).not.toBe(steps);
        steps.length = 0;
        expect(phase.steps).toHaveLength(1);
        a.id = 'changed';
        expect(phase.steps[0]).toMatchObject({ from: 'app' });
    });

    test('repeated fragments need no prefix and render with unique IDs', async () => {
        const { actor, request, reply, send, redirect, action, phase } = await helpers();
        const app = actor('app', 'Application'), auth = actor('auth', 'Authorization');
        function exchange(app: types.diagrams.Actor, auth: types.diagrams.Actor): types.diagrams.Step[] {
            return [request(app, auth, 'Request token'), reply(auth, app, 'Return token')];
        }
        const model: types.diagrams.Scenario = { actors: [app, auth], steps: [
            phase('Sign in', [action(app, 'Prepare request'), ...exchange(app, auth)]),
            phase('Refresh', exchange(app, auth)),
            send(app, auth, 'Send audit event'), redirect(auth, app, 'Resume application'),
        ] };
        expect(await scenarioValidate(ctx, null, { model })).toEqual({ valid: true, actors: 2, steps: 9, phases: 2, messages: 6, actions: 1 });
        const result = await scenarioDiagram(ctx, null, { model });
        expect(result.phases).toHaveLength(2);
        expect(result.actions).toHaveLength(1);
        expect(result.messages.map(m => m.id)).toEqual(['step-2', 'step-3', 'step-5', 'step-6', 'step-8', 'step-9']);
        expect(result.svg).toContain('data-action-id="step-1"');
        expect(result.svg).toContain('stroke-dasharray="5 4"');
        expect(result.svg).toContain('Sign in');
        expect(result.svg).toContain('Refresh');
        expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    });

    test('explicit IDs work for every helper and reserve values across kinds', async () => {
        const h = await helpers(), a = h.actor('a', 'Actor');
        for (const kind of ['request', 'reply', 'send', 'redirect'] as const) {
            expect(h[kind](a, a, kind, { id: kind }).id).toBe(kind);
        }
        expect(h.action(a, 'Act', { id: 'step-1' }).id).toBe('step-1');
        expect(h.phase('Phase', [], { id: 'step-3' }).id).toBe('step-3');
        expect(h.request(a, a, 'Auto').id).toBe('step-2');
        expect(h.phase('Next', []).id).toBe('step-4');
        expect(() => h.send(a, a, 'Duplicate explicit', { id: 'step-1' })).toThrow('Duplicate');
        expect(() => h.action(a, 'Duplicate generated', { id: 'step-2' })).toThrow('Duplicate');
        expect(h.reply(a, a, 'After failures').id).toBe('step-5');
    });

    test('renderer remains authoritative for actor registration, root/actor collisions and ID syntax', async () => {
        const h = await helpers();
        const app = h.actor('app', 'Application'), missing = h.actor('missing', 'Not registered');
        for (const step of [h.request(app, missing, 'Request'), h.action(missing, 'Act')]) {
            const model = { actors: [app], steps: [h.phase('Phase', [step])] };
            await expect(scenarioValidate(ctx, null, { model })).rejects.toThrow('Unknown actor reference');
            await expect(scenarioDiagram(ctx, null, { model })).rejects.toThrow('Unknown actor reference');
        }
        for (const id of [' ', 'x'.repeat(129)]) {
            const model = { actors: [app], steps: [h.action(app, 'Invalid', { id })] };
            await expect(scenarioDiagram(ctx, null, { model })).rejects.toThrow();
        }
        for (const model of [
            { actors: [app], steps: [h.action(app, 'Actor collision', { id: 'app' })] },
            { id: 'root', actors: [app], steps: [h.phase('Root collision', [], { id: 'root' })] },
            { actors: [h.actor('step-1', 'Collision')], steps: [(await helpers()).phase('Auto collision', [])] },
        ]) await expect(scenarioDiagram(ctx, null, { model })).rejects.toThrow('globally unique');
        const repeated = h.action(app, 'Reused object');
        await expect(scenarioDiagram(ctx, null, { model: { actors: [app], steps: [repeated, repeated] } })).rejects.toThrow('globally unique');
    });

    test('nested/empty phases allocate after their children; factories are deterministic and isolated', async () => {
        const h = await helpers(), other = await helpers();
        const a = h.actor('a', 'Actor');
        const model = { actors: [a], steps: [h.phase('Outer', [h.phase('', []), h.phase('Inner', [h.action(a, 'Act')])])] };
        expect(model.steps[0].id).toBe('step-4');
        expect(model.steps[0].steps.map(s => s.id)).toEqual(['step-1', 'step-3']);
        expect(await scenarioValidate(ctx, null, { model })).toMatchObject({ phases: 3, steps: 4 });
        expect((await scenarioDiagram(ctx, null, { model })).phases).toHaveLength(3);
        const same = { actors: [a], steps: [other.phase('Outer', [other.phase('', []), other.phase('Inner', [other.action(a, 'Act')])])] };
        expect(same).toEqual(model);
        h.action(a, 'Only first', { id: 'stable' });
        expect(other.action(a, 'Second', { id: 'stable' }).id).toBe('stable');
        expect(other.action(a, 'Next').id).toBe('step-5');
    });
});
