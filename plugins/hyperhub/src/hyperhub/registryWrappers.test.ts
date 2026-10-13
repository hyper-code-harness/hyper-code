import { expect, test } from 'bun:test';
import search from './search';
import get from './get';
import resolve from './resolve';
for (const [action, fn] of [['search',search],['get',get],['resolve',resolve]] as const) {
  test(`hyperhub.${action} delegates to bounded request`,async () => {
    const opts = {baseUrl:'https://registry.example',repo:'test',name:'plugin',commit:'a'.repeat(40)};
    const result = {plugin:{name:'plugin'}};
    const ctx = {fns:{hyperhub:{registryRequest:async (received: Record<string,unknown>)=>{expect(received).toEqual({...opts,action});return result;}}}} as unknown as Context;
    expect(await fn(ctx,null,opts)).toBe(result);
  });
}
