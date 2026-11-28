/**
 * Observe bounded provider JSON or SSE usage while forwarding each original response byte.
 *
 * Internal no-tee response observer. Reads only when the consumer pulls, preserves cancellation, handles fragmented UTF-8, CRLF, multiline SSE data and terminal events. JSON buffering is limited to 256 KiB and each SSE line/event to 64 KiB. Missing counts remain null; cumulative usage replaces rather than sums. OpenAI input subtracts explicitly reported cached input; absent cache detail leaves noncached input unknown.
 * @param opts.response Original provider response whose body will be forwarded without byte changes.
 * @param opts.attempt Internally minted attempt; externally supplied objects are ignored.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Original provider response whose body will be forwarded without byte changes. */
        response: Response;
        /** Internally minted attempt; externally supplied objects are ignored. */
        attempt: types.llmUsage.Attempt;
    },
): Promise<Response> {
    const st=await ctx.fns.llmUsage.getState({});
    const a=opts.attempt, response=opts.response;
    if(!st.attempts.has(a) || a.finalized) return response;
    a.httpStatus=response.status;
    const settle=async(status:"success"|"error"|"cancelled")=>{
        try { await ctx.fns.llmUsage.settle({scope:a.scope,attempt:a,status:!response.ok?"error":status}); }
        catch { /* Optional ledger writes must not alter response bytes, cancellation or errors. */ }
    };
    if(!response.body) { await settle(response.ok?"success":"error"); return response; }
    // Error JSON may still contain actual usage; parse within the same strict cap, never persist text.
    const contentType=response.headers.get("content-type")??"";
    const sse=contentType.includes("text/event-stream");
    const json=/application\/(?:[a-z0-9.-]+\+)?json/i.test(contentType);
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    const cap=64*1024, jsonCap=256*1024;
    let line="", eventData="", eventName="", jsonText="", lineOverflow=false, eventOverflow=false, jsonOverflow=false, afterCR=false;
    let terminal:"success"|"error"|null=null, hadError=!response.ok;
    const object=(value:unknown):Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
    const number=(value:unknown):number|null => typeof value==="number" && Number.isSafeInteger(value) && value>=0?value:null;
    const set=(key:"inputTokens"|"outputTokens"|"cacheReadTokens"|"cacheWriteTokens",value:unknown)=>{const n=number(value); if(n!==null) a[key]=n;};
    const consume=(value:unknown)=>{
        const root=object(value), responseObject=object(root.response);
        const type=typeof root.type==="string"?root.type:"";
        if(root.error || type==="error" || type==="response.failed" || type==="response.incomplete" || responseObject.error || responseObject.status==="failed" || responseObject.status==="incomplete") hadError=true;
        let usage=object(root.usage);
        if(a.api==="anthropic" && type==="message_start") usage=object(object(root.message).usage);
        if(a.api==="responses" && root.response) usage=object(responseObject.usage);
        if(!a.remote) {
            if(a.api==="anthropic") {
                set("inputTokens",usage.input_tokens); set("outputTokens",usage.output_tokens);
                set("cacheReadTokens",usage.cache_read_input_tokens); set("cacheWriteTokens",usage.cache_creation_input_tokens);
            } else {
                const total=number(a.api==="openai"?usage.prompt_tokens:usage.input_tokens);
                const cached=number(object(a.api==="openai"?usage.prompt_tokens_details:usage.input_tokens_details).cached_tokens);
                if(total!==null && cached!==null && cached>total) { a.inputTokens=null; a.cacheReadTokens=null; }
                else {
                    if(cached!==null) set("cacheReadTokens",cached);
                    if(total!==null && cached!==null) set("inputTokens",total-cached);
                }
                set("outputTokens",a.api==="openai"?usage.completion_tokens:usage.output_tokens);
                // No zero is inferred for cache writes or missing cache read details.
            }
        }
        if(type==="message_stop" || type==="response.completed") terminal=hadError?"error":"success";
        if(type==="error" || type==="response.failed" || type==="response.incomplete") terminal="error";
    };
    const dispatch=()=>{
        // A bounded protocol event name remains authoritative when its optional JSON payload exceeds the cap.
        if(eventName==="message_stop" || eventName==="response.completed") terminal=hadError?"error":"success";
        if(eventName==="response.failed" || eventName==="response.incomplete") { hadError=true; terminal="error"; }
        if(eventName==="error") { hadError=true; terminal="error"; }
        if(!eventOverflow && eventData) {
            const data=eventData.endsWith("\n")?eventData.slice(0,-1):eventData;
            if(data.trim()==="[DONE]") terminal=hadError?"error":"success";
            else { try { consume(JSON.parse(data)); } catch { /* Malformed data is not usage; EOF without a terminal remains an error. */ } }
        }
        eventData=""; eventName=""; eventOverflow=false;
    };
    const endLine=()=>{
        if(lineOverflow) eventOverflow=true;
        else if(line==="") dispatch();
        else {
            const colon=line.indexOf(":");
            const field=colon<0?line:line.slice(0,colon);
            let value=colon<0?"":line.slice(colon+1); if(value.startsWith(" ")) value=value.slice(1);
            if(field==="data" && !eventOverflow) { if(eventData.length+value.length+1>cap) {eventOverflow=true;eventData="";} else eventData+=value+"\n"; }
            else if(field==="event") eventName=value;
        }
        line=""; lineOverflow=false;
    };
    const feed=(text:string)=>{
        if(terminal || (!sse&&!json)) return;
        if(json) { if(!jsonOverflow) { if(jsonText.length+text.length>jsonCap) {jsonOverflow=true;jsonText="";} else jsonText+=text; } return; }
        for(const ch of text) {
            if(afterCR) {afterCR=false;if(ch==="\n")continue;}
            if(ch==="\r") {endLine();afterCR=true;}
            else if(ch==="\n") endLine();
            else if(!lineOverflow) { if(line.length>=cap) {lineOverflow=true;line="";} else line+=ch; }
            if(terminal) break;
        }
    };
    const body=new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const part=await reader.read();
                if(part.done) {
                    feed(decoder.decode());
                    if(sse && !terminal) { if(line || lineOverflow) endLine(); if(eventData || eventName || eventOverflow) dispatch(); }
                    if(json && jsonOverflow) terminal=hadError?"error":"success";
                    if(json && !jsonOverflow) { try { consume(JSON.parse(jsonText)); terminal=hadError?"error":"success"; } catch { terminal="error"; } }
                    jsonText=""; line=""; eventData="";
                    await settle(terminal??(sse||json?"error":"success"));
                    reader.releaseLock(); controller.close(); return;
                }
                if(!terminal && (sse||json)) for(let offset=0;offset<part.value.byteLength;offset+=8192) feed(decoder.decode(part.value.subarray(offset,offset+8192),{stream:true}));
                if(terminal) await settle(terminal);
                controller.enqueue(part.value);
            } catch(error) {
                await settle(error instanceof Error && error.name==="AbortError"?"cancelled":"error");
                reader.releaseLock(); controller.error(error);
            }
        },
        async cancel(reason) {
            jsonText=""; line=""; eventData="";
            await settle(terminal??"cancelled");
            try { await reader.cancel(reason); } finally { reader.releaseLock(); }
        }
    },{highWaterMark:0});
    const wrapped=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    for(const key of ["url","redirected","type"] as const) Object.defineProperty(wrapped,key,{value:response[key]});
    return wrapped;
}
