import { createSign } from "node:crypto";

/**
 * Returns a short-lived OAuth access token for Vertex AI minted from the
 * dedicated Nano Banana service-account key kept in encrypted local secret
 * storage (namespace `nanobanana`, name `serviceAccountKey`, the JSON key file).
 * Never falls back to the ambient gcloud/ADC identity, so the plugin can only
 * act with the narrow role granted to that service account.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** Secret namespace holding the service-account JSON key. @default "nanobanana" */
  namespace?: string;
  /** Secret name holding the service-account JSON key. @default "serviceAccountKey" */
  name?: string;
}): Promise<string> {
  const namespace = opts.namespace ?? "nanobanana";
  const name = opts.name ?? "serviceAccountKey";
  const cache = ((ctx.state as any).nanobanana ??= {}) as { token?: string; expiresAt?: number };
  if (cache.token && (cache.expiresAt ?? 0) - 60_000 > Date.now()) return cache.token;

  const raw = await ctx.fns.secrets.getLocal({ namespace, name });
  if (!raw) throw new Error(`nanobanana: service-account key is not configured (secret://${namespace}/${name}); ambient gcloud credentials are intentionally not used`);
  let key: { client_email?: string; private_key?: string; token_uri?: string };
  try { key = JSON.parse(raw); } catch { throw new Error(`nanobanana: secret://${namespace}/${name} is not a service-account JSON key`); }
  if (!key.client_email || !key.private_key) throw new Error(`nanobanana: secret://${namespace}/${name} lacks client_email/private_key`);

  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: tokenUri, iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const json = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !json.access_token) throw new Error(`nanobanana: token exchange failed: ${json.error_description ?? json.error ?? response.status}`);
  cache.token = json.access_token;
  cache.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  return json.access_token;
}
