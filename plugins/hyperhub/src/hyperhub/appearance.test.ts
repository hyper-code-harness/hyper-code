import {test,expect} from 'bun:test';
import configPage from './configPage';
const origin='https://registry.example';
function fixture() {return {fns:{hyperhub:{configuredHubs:async()=>[{label:'Team',origin,enabled:true}]}}} as any;}
test('configuration shares stylesheet and retains explicit save and labelled controls',async()=>{const html=await configPage(fixture(),null,{});expect(html).toContain('/hyperhub/hyperhub.css');expect(html).toContain('class="hh-field"');expect(html).toContain('name="origin0"');expect(html).toContain('Remove on save');expect(html).toContain('Only applied when you save');});
