import { afterEach, describe, expect, test } from "bun:test";
import registryRequest from "./registryRequest";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ctx = {} as Context;
const opts = { baseUrl: "https://registry.example", action: "search" as const };
const mockFetch = (fn: (url: URL, init: RequestInit) => Promise<Response>) => {
  globalThis.fetch = fn as typeof fetch;
};

describe("hyperhub.registryRequest", () => {
  test("uses bounded GET, no redirects or credentials, and encoded parameters", async () => {
    mockFetch(async (url, init) => {
      expect(url.origin).toBe(opts.baseUrl);
      expect(url.pathname).toBe("/api/registry/search");
      expect(url.searchParams.get("q")).toBe("x&repo=other");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.credentials).toBe("omit");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers).toEqual({ Accept: "application/json" });
      return Response.json({ plugins: [] });
    });
    expect(await registryRequest(ctx, null, { ...opts, q: "x&repo=other" })).toEqual({ plugins: [] });
  });

  test("forwards optional search limit and leaves default to server", async () => {
    const limits: (string | null)[] = [];
    mockFetch(async url => { limits.push(url.searchParams.get('limit')); return Response.json({plugins:[]}); });
    await registryRequest(ctx,null,opts);
    await registryRequest(ctx,null,{...opts,limit:20});
    await registryRequest(ctx,null,{...opts,limit:200});
    expect(limits).toEqual([null,'20','200']);
  });
  test("rejects limits outside server bounds before fetch", async () => {
    let calls=0;
    mockFetch(async () => { calls++; return Response.json({plugins:[]}); });
    for (const limit of [0,-1,201,1.5,NaN,Infinity]) await expect(registryRequest(ctx,null,{...opts,limit})).rejects.toThrow('limit');
    expect(calls).toBe(0);
  });

  test("normalizes exact uppercase commits for the server", async () => {
    mockFetch(async (url) => { expect(url.searchParams.get('commit')).toBe('a'.repeat(40)); return Response.json({plugin:{}}); });
    await registryRequest(ctx,null,{...opts,action:'resolve',repo:'r',name:'p',commit:'A'.repeat(40)});
  });

  test("rejects unsafe origins and invalid action before fetching", async () => {
    mockFetch(async () => { throw new Error("unexpected fetch"); });
    for (const baseUrl of ["http://registry.example", "https://user:secret@registry.example", "https://registry.example/path", "https://registry.example?q=secret", "https://registry.example#secret", "https://registry.example?", "https://registry.example#", "not a URL"]) {
      await expect(registryRequest(ctx, null, { ...opts, baseUrl })).rejects.toThrow("credential-free HTTPS origin");
    }
    await expect(registryRequest(ctx, null, { ...opts, action: "other" as "search" })).rejects.toThrow("action");
  });

  test("rejects missing required keys and invalid commit before fetching", async () => {
    mockFetch(async () => { throw new Error("unexpected fetch"); });
    await expect(registryRequest(ctx, null, { ...opts, action: "get" })).rejects.toThrow("repo and name");
    await expect(registryRequest(ctx, null, { ...opts, action: "resolve", repo: "r", name: "p", commit: "main" })).rejects.toThrow("commit");
  });

  test("rejects errors, redirects and unexpected media types and cancels bodies", async () => {
    for (const config of [{ status: 403 }, { status: 302 }, { status: 200, headers: { "content-type": "text/html" } }]) {
      let cancelled = false;
      mockFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), config));
      await expect(registryRequest(ctx, null, opts)).rejects.toThrow("Registry");
      expect(cancelled).toBe(true);
    }
  });

  test("rejects advertised oversized response before reading", async () => {
    let cancelled = false;
    mockFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json", "content-length": "2000001" } }));
    await expect(registryRequest(ctx, null, opts)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });

  test("caps streamed bytes even without Content-Length and cancels reader", async () => {
    let cancelled = false;
    mockFetch(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
    await expect(registryRequest(ctx, null, opts)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });

  test("accepts JSON exactly at the byte cap", async () => {
    mockFetch(async () => new Response('{}' + ' '.repeat(1_999_998), { headers: { "content-type": "application/json; charset=utf-8" } }));
    expect(await registryRequest(ctx, null, opts)).toEqual({});
  });

  test("rejects invalid JSON, UTF-8 and non-object JSON", async () => {
    for (const body of ["null", "[]", "3", "bad JSON", new Uint8Array([0xff])]) {
      mockFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }));
      await expect(registryRequest(ctx, null, opts)).rejects.toThrow("Invalid registry response");
    }
  });

  test("timeout covers stalled response body and cancels it", async () => {
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => { expect(ms).toBe(15_000); return realTimeout(20); }) as typeof AbortSignal.timeout;
    let cancelled = false;
    mockFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
    try {
      await expect(registryRequest(ctx, null, opts)).rejects.toThrow("timed out");
      expect(cancelled).toBe(true);
    } finally { AbortSignal.timeout = realTimeout; }
  });
});

test('repository discovery only treats 404 as missing; create uses guarded empty POST',async()=>{
 let calls=0;
 mockFetch(async(url,init)=>{calls++;expect(url.pathname).toBe('/git/team/example.git/info/refs');expect(url.searchParams.get('service')).toBe('git-upload-pack');expect(init.method).toBe('GET');return new Response('',{status:404});});
 expect(await registryRequest(ctx,null,{baseUrl:opts.baseUrl,repo:'team/example',action:'repoStatus'})).toEqual({exists:false});
 for(const status of [401,403,429,500]) {mockFetch(async()=>new Response('',{status}));await expect(registryRequest(ctx,null,{baseUrl:opts.baseUrl,repo:'team/example',action:'repoStatus'})).rejects.toThrow('HTTP '+status);}
 const before=calls;await expect(registryRequest(ctx,null,{baseUrl:opts.baseUrl,repo:'team/example',action:'createRepo'})).rejects.toThrow('confirmation');expect(calls).toBe(before);
 mockFetch(async(url,init)=>{expect(url.pathname).toBe('/api/repos/team/example');expect(url.search).toBe('');expect(init.method).toBe('POST');expect(init.body).toBeUndefined();return Response.json({created:true},{status:201});});
 expect(await registryRequest(ctx,null,{baseUrl:opts.baseUrl,repo:'team/example',action:'createRepo',confirmed:true})).toEqual({created:true});
});
