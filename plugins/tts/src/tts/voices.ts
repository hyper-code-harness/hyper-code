// List Google Cloud TTS voices. OAuth values stay private in 1Password.
/**
 * Resolves and caches a Google OAuth access token for voice-list calls.
 *
 * @param ctx - Runtime context used to resolve stored OAuth credentials.
 * @returns A valid bearer access token.
 */
async function accessToken(ctx: Context) {
    const cache = ((ctx.state as any).tts ??= {} as { token?: { access_token: string; expires_at: number } });
    if (cache.token && Date.now() < cache.token.expires_at - 60_000) return cache.token.access_token;
    const [tokenRaw, clientRaw] = await Promise.all([
        ctx.fns.secrets.get({ ref: "op://hyper/tts token.json/value", namespace: "tts", name: "token" }),
        ctx.fns.secrets.get({ ref: "op://hyper/tts client_secret.json/value", namespace: "tts", name: "client" }),
    ]);
    if (!tokenRaw || !clientRaw) throw new Error("Google Cloud TTS credentials are not configured");
    const token = JSON.parse(tokenRaw), secret = JSON.parse(clientRaw), creds = secret.installed || secret.web;
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.access_token) throw new Error(`TTS token refresh failed (${res.status})`);
    cache.token = { access_token: json.access_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return cache.token.access_token;
}

/**
 * Lists available Google Cloud text-to-speech voices.
 *
 * Use to discover valid voice names for the google engine of tts.speak, optionally
 * narrowed to one language. Gemini prebuilt voices such as Kore or Puck are not listed
 * here — they are documented in the tts plugin overview.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
  /** Optional language-code prefix used to filter voices. */
  lang?: string }): Promise<Array<{
    /** Google Cloud voice name passed to tts.speak as `voice`. */
    name: string;
    /** SSML gender reported by the API, such as MALE or FEMALE. */
    gender: string;
    /** BCP 47 language codes the voice supports. */
    languages: string[];
}>> {
    const access_token = await accessToken(ctx);
    const url = `https://texttospeech.googleapis.com/v1/voices${opts?.lang ? `?languageCode=${encodeURIComponent(opts.lang)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`Voices API error (${res.status})`);
    return (json.voices ?? []).map((v: any) => ({ name: v.name, gender: v.ssmlGender, languages: v.languageCodes }));
}
