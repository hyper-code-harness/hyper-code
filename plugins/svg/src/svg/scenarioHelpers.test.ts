import {test,expect} from 'bun:test';
import compatibility from './scenarioHelpers';
test('legacy helper API forwards to diagrams',async()=>{const sentinel={actor:()=>({id:'a',label:'A'})};const ctx={fns:{diagrams:{scenarioHelpers:async()=>sentinel}}} as unknown as Context;expect(await compatibility(ctx,null,{})).toBe(sentinel as never);});
