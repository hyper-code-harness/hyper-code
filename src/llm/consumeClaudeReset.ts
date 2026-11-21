/**
 * Spend one Claude reset only from a fresh explicitly confirmed one-use ticket
 *
 * Use only after showing the prepared ticket to the user and receiving confirmation. Revalidates account organization, grant, scope and remaining count. Atomically claims the ticket and locks the organization, sends at most one POST with a stable request id, never retries ambiguous outcomes, and preserves concurrent quota writes during cache reconciliation. Uncertain outcomes block this organization for ten minutes.
 * @param opts.ticketId UUID returned by prepareClaudeReset after displaying account, grant and finite cost.
 * @param opts.confirmed Must be exactly true after the user explicitly confirms spending one reset.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** UUID returned by prepareClaudeReset after displaying account, grant and finite cost. */
        ticketId: string;
        /** Must be exactly true after the user explicitly confirms spending one reset. */
        confirmed: boolean;
    },
): Promise<types.llm.ClaudeResetAttempt> {
    if (opts.confirmed !== true || typeof opts.ticketId !== 'string' || !/^[0-9a-f-]{36}$/i.test(opts.ticketId)) throw new Error('Explicit confirmation of a valid reset ticket is required');
        const key = 'llm:claude-reset:attempt:' + opts.ticketId;
        const claimed = await ctx.fns.procs.db.select({sql: `UPDATE kv SET value=jsonb_set(value::jsonb,'{state}','"sending"'::jsonb)::text WHERE key=? AND value::jsonb->>'state'='prepared' AND (value::jsonb->>'expiresAt')::bigint>? RETURNING value`,params:[key,Date.now()]});
        if (!claimed.length) {
            const rows = await ctx.fns.procs.db.select({sql:'SELECT value FROM kv WHERE key=?',params:[key]});
            const prior = rows[0] ? JSON.parse(rows[0].value) as types.llm.ClaudeResetAttempt : null;
            if (!prior || prior.state === 'prepared') throw new Error('This confirmation expired. Reopen Reset limit to review fresh availability.');
            return prior;
        }
        const attempt = JSON.parse(claimed[0].value) as types.llm.ClaudeResetAttempt;
        const lockKey = 'llm:claude-reset:org:' + attempt.organizationId;
        const lock = JSON.stringify({id:attempt.id,expiresAt:Date.now()+600000});
        const acquired = await ctx.fns.procs.db.select({sql:`INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value WHERE (kv.value::jsonb->>'expiresAt')::bigint<? RETURNING key`,params:[lockKey,lock,Date.now()]});
        const finish = async (outcome: NonNullable<types.llm.ClaudeResetAttempt['outcome']>) => {
            attempt.state = 'done'; attempt.outcome = outcome;
            await ctx.fns.procs.db.run({sql:'UPDATE kv SET value=? WHERE key=?',params:[JSON.stringify(attempt),key]});
            if (outcome !== 'uncertain' && acquired.length) await ctx.fns.procs.db.run({sql:'DELETE FROM kv WHERE key=? AND value=?',params:[lockKey,lock]});
            return attempt;
        };
        if (!acquired.length) return await finish('busy');
        let sent = false;
        let outcome: NonNullable<types.llm.ClaudeResetAttempt['outcome']> = 'unavailable';
        const usageKey = 'llm:usage:' + attempt.provider + ':' + attempt.account;
        let before: {version:string; tuple:string} | undefined;
        try {
            const state = await ctx.fns.llm.claudeResetStatus({provider:attempt.provider,account:attempt.account});
            const credit = state.resetCredits.credits?.find(c=>c.id===attempt.grantId);
            if (state.organizationId !== attempt.organizationId || state.nextGrantId !== attempt.grantId || !credit?.usableNow || credit.remainingCount !== attempt.remainingCount || credit.expiresAt !== attempt.grantExpiresAt || (credit.description || '') !== attempt.clears || (state.cooldownUntil != null && state.cooldownUntil>Date.now()) || attempt.expiresAt<=Date.now() || !/^[a-z0-9_-]{1,40}$/.test(attempt.grantId)) return await finish('changed');
            const token = attempt.provider === 'claude-code' ? await ctx.fns.llm.refreshClaudeCode({account:attempt.account}) : await ctx.fns.llm.getAnthropicOAuthToken({account:attempt.account});
            if (!token) return await finish('unavailable');
            const headers = {authorization:'Bearer '+token,'content-type':'application/json','anthropic-beta':'oauth-2025-04-20','user-agent':'claude-cli/'+await ctx.fns.llm.claudeCodeCliVersion({})+' (external, cli)'};
            // Recheck organization using exactly the bearer that will perform the write.
            const profileRes = await ctx.fns.llm.connectFetch({url:'https://api.anthropic.com/api/oauth/profile',ms:10000,init:{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)}});
            if (!profileRes.ok) { await profileRes.body?.cancel(); return await finish('unavailable'); }
            const profile = await profileRes.json() as {organization?:{uuid?:string}};
            if (profile.organization?.uuid !== attempt.organizationId) return await finish('changed');
            before = (await ctx.fns.procs.db.select({sql:'SELECT xmin::text AS version,ctid::text AS tuple FROM kv WHERE key=?',params:[usageKey]}))[0];
            if (attempt.expiresAt<=Date.now()) return await finish('changed');
            sent = true;
            const res = await ctx.fns.llm.connectFetch({url:'https://api.anthropic.com/api/organizations/'+attempt.organizationId+'/reset_rate_limits',ms:25000,init:{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify({program:'cedar_ember',grant_id:attempt.grantId,request_id:attempt.id})}});
            if (!res.ok) { await res.body?.cancel(); outcome='uncertain'; }
            else {
                const data: unknown = await res.json();
                const result = data && typeof data==='object' ? (data as {result?:unknown}).result : null;
                outcome = result==='reset'||result==='already_used'||result==='not_limited'||result==='cooldown'||result==='ineligible'||result==='unavailable' ? result : 'uncertain';
            }
        } catch {
            // Never echo HTTP/token errors and never replay a write after a timeout or an unreadable response.
            outcome = sent ? 'uncertain' : 'unavailable';
        }
        // Persist the conservative refresh status too, so a thrown refresh still replays an honest result.
        attempt.usageRefreshed = false;
        // Record the provider outcome before best-effort cache refresh. Refresh failure is not reset failure.
        await finish(outcome);
        try {
            if (outcome==='reset' && before) {
                // xmin + ctid compare-and-swap preserves even an identical concurrent failure write.
                await ctx.fns.procs.db.run({sql:'DELETE FROM kv WHERE key=? AND xmin::text=? AND ctid::text=?',params:[usageKey,before.version,before.tuple]});
            }
            const refreshed = await ctx.fns.llm.refreshUsage({provider:attempt.provider,account:attempt.account,maxAgeMs:0,preserveOnFailure:true});
            attempt.usageRefreshed = refreshed.some(row=>row.provider===attempt.provider && row.account===attempt.account && row.status==='refreshed');
            await ctx.fns.procs.db.run({sql:'UPDATE kv SET value=? WHERE key=?',params:[JSON.stringify(attempt),key]});
            ctx.fns.procs.events.refresh({topic:'llm-usage',reason:'Claude reset checked'});
            ctx.fns.procs.events.refresh({topic:'llm-accounts',reason:'Claude reset checked'});
        } catch {
            attempt.usageRefreshed = false;
        }
        return attempt;
}
