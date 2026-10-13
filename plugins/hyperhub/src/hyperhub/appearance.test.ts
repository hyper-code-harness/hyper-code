import {test,expect} from 'bun:test';
import page from './page';
import configPage from './configPage';
const commit='a'.repeat(40),origin='https://registry.example';
function fixture(status='managed') {return {fns:{hyperhub:{installed:async()=>({plugins:[{name:'example',repo:'team/example',baseUrl:origin,commit,managed:true,status}],errors:[]}),configuredHubs:async()=>[{label:'Team',origin,enabled:true}],search:async()=>({plugins:[{name:'example',repo:'team/example',commit,version:'1.2.3',description:'An extension'}]})}}} as any;}
test('configuration shares stylesheet and retains explicit save and labelled controls',async()=>{const html=await configPage(fixture(),null,{});expect(html).toContain('/hyperhub/hyperhub.css');expect(html).toContain('class="hh-field"');expect(html).toContain('name="origin0"');expect(html).toContain('Remove on save');expect(html).toContain('Only applied when you save');});
