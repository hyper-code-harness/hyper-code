# Live IBM-inspired examples

Paste each body into a trusted `svg tsx` fence. Helpers are synchronous after one awaited factory call.

## Failover — flow stays in SVG in this first extraction

```svg tsx
const {step,decision,database,link}=await ctx.fns.svg.flowHelpers({});
const a=step('Primary failure'), b=decision('Quorum available?'), c=step('Fence old primary'), d=decision('Fencing confirmed?'), e=database('Promote replica'), f=step('Switch traffic'), stop=step('STOP: manual recovery');
return (await ctx.fns.svg.flowDiagram({theme:'ibm-inspired',title:'Postgres failover',direction:'down',compact:true,columns:3,mainPath:[a,b,c,d,e,f].map(n=>n.id),nodes:[a,b,c,d,e,f,stop],edges:[link(a,b),link(b,c,'Yes'),link(b,stop,'No',{bundle:'stop'}),link(c,d),link(d,e,'Yes'),link(d,stop,'No',{bundle:'stop'}),link(e,f)]})).svg;
```

## OIDC — new canonical interaction API

```svg tsx
const {actor,request,reply,redirect,action,phase}=await ctx.fns.diagrams.scenarioHelpers({});
const browser=actor('browser','Browser'), app=actor('app','Relying party'), idp=actor('idp','Identity provider');
return (await ctx.fns.diagrams.scenarioDiagram({theme:'ibm-inspired',model:{title:'OIDC authorization code + PKCE',actors:[browser,app,idp],steps:[
 phase('Authorization',[request(browser,app,'Sign in'),action(app,'Create state, nonce and PKCE verifier'),redirect(app,browser,'Authorization URL + challenge'),request(browser,idp,'Authenticate and consent'),redirect(idp,browser,'Code + state'),request(browser,app,'Callback with code + state')]),
 phase('Token exchange',[action(app,'Validate state'),request(app,idp,'Code + verifier'),reply(idp,app,'ID token + access token'),action(app,'Validate signature, issuer, audience and nonce'),reply(app,browser,'Authenticated session cookie')])
]}})).svg;
```

These are illustrative message/flow sketches, not executable operational or security specifications. Saved standalone renders: `plugins/svg/fixtures/ibm-failover.svg` and `ibm-oidc.svg`.
