import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import fetchRemote from './fetch';
import quote from '../remote/quote';
import bridge from './inferenceScript';

// Real local child process, no SSH/network/DB: exercise framing, stdin and termination.
for (const mode of ['large', 'exit', 'abort', 'cancel'] as const) test(`SSH process ${mode}`, async () => {
    const dir = await mkdtemp(import.meta.dir + '/../../.hyper/tmp/ssh-process-');
    const marker = dir + '/closed';
    const fixture = dir + '/fixture.ts';
    await Bun.write(fixture, `process.on('SIGTERM', async () => { await Bun.write(${JSON.stringify(marker)}, 'closed'); process.exit(0); });
const input = await Bun.stdin.text(); const r = JSON.parse(input);
if (${JSON.stringify(mode)} === 'large') { console.log(JSON.stringify({status:200,headers:{}})); process.stdout.write(String(r.body.length)); }
else if (${JSON.stringify(mode)} === 'exit') { console.log(JSON.stringify({status:200,headers:{}})); process.stdout.write('partial'); process.exitCode=7; }
else { ${mode === 'cancel' ? "console.log(JSON.stringify({status:200,headers:{}}));" : ''} setInterval(()=>{},1000); }
`);
    const ctx: any = { fns: { sshCli: { connection: async () => ({ bin: process.execPath, args: [fixture], host: 'unused' }), inferenceScript: () => '' }, remote: { quote: (opts: any) => quote({} as any, null, opts) } } };
    try {
        const controller = new AbortController();
        const pending = fetchRemote(ctx, null, { host: 'gpu', provider: 'codex', init: { body: 'x'.repeat(2_000_000), signal: controller.signal } });
        if (mode === 'abort') { setTimeout(() => controller.abort(), 150); await expect(pending).rejects.toThrow(); }
        else {
            const res = await pending;
            if (mode === 'large') expect(await res.text()).toBe('2000000');
            if (mode === 'exit') await expect(res.text()).rejects.toThrow('interrupted');
            if (mode === 'cancel') await res.body!.cancel();
        }
        if (mode === 'abort' || mode === 'cancel') {
            for (let i = 0; i < 100 && !(await Bun.file(marker).exists()); i++) await Bun.sleep(10);
            expect(await Bun.file(marker).exists()).toBe(true);
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const provider of ['codex', 'claude-code'] as const) test(`Python ${provider} remote auth and no credential leakage`, async () => {
    const dir = await mkdtemp(import.meta.dir + '/../../.hyper/tmp/ssh-python-');
    try {
        const script = bridge({} as any, null, {});
        const fixture = `import os,sys,json,io,time,base64,urllib.request
home=${JSON.stringify(dir)};os.environ['HOME']=home
p=${JSON.stringify(provider)}
root=home+'/.hyper/ssh-accounts/'+p+'/default';os.makedirs(root+('/.codex' if p=='codex' else '/.claude'),mode=0o700)
token='x.'+base64.urlsafe_b64encode(json.dumps({'exp':time.time()+3600,'https://api.openai.com/auth':{'chatgpt_account_id':'remote-account'}}).encode()).decode().rstrip('=')+'.remote-secret'
creds={'tokens':{'access_token':token}} if p=='codex' else {'claudeAiOauth':{'accessToken':token,'expiresAt':(time.time()+3600)*1000}}
with open(root+('/.codex/auth.json' if p=='codex' else '/.claude/.credentials.json'),'w') as f:json.dump(creds,f)
class Reply:
 status=200;headers={'Content-Type':'text/event-stream'}
 def __init__(self):self.n=0
 def read1(self,n):
  self.n+=1
  return b'data: ok\\n\\n' if self.n==1 else b''
class Opener:
 def open(self,req,timeout):
  assert req.get_header('Authorization')=='Bearer '+token
  assert req.get_header('Cookie') is None
  assert req.get_header('Host') is None
  if p=='codex':assert req.get_header('Chatgpt-account-id')=='remote-account'
  return Reply()
urllib.request.build_opener=lambda *args:Opener()
r={'ssh':{'provider':p,'account':'default'},'url':'https://chatgpt.com/backend-api/codex/responses' if p=='codex' else 'https://api.anthropic.com/v1/messages','method':'POST','body':'{}','headers':{'authorization':'LOCAL-SECRET','cookie':'cookie-secret','host':'evil'}}
sys.stdin=io.StringIO(json.dumps(r))
exec(${JSON.stringify(script)})
`;
        const proc = Bun.spawn(['python3', '-c', fixture], { stdout: 'pipe', stderr: 'pipe' });
        const output = await new Response(proc.stdout).text(); const error = await new Response(proc.stderr).text();
        expect(error).toBe(''); expect(await proc.exited).toBe(0); expect(output).toContain('data: ok');
        expect(output).not.toContain('remote-secret'); expect(output).not.toContain('LOCAL-SECRET');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
