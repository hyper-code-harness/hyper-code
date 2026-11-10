import {test,expect} from 'bun:test';
import compatibility from './sequenceDiagram';
test('legacy sequence API forwards participants messages and theme',async()=>{const input={participants:[],messages:[],theme:'ibm-inspired' as const};let received;const sentinel={svg:'<svg/>'};const ctx={fns:{diagrams:{sequenceDiagram:async(o:typeof input)=>{received=o;return sentinel;}}}} as unknown as Context;expect(await compatibility(ctx,null,input)).toBe(sentinel as never);expect(received).toEqual(input);});
