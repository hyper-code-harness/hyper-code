// Set-Cookie rewrite for frames in Hyper tabs (used by worker.js, tested by cookies.test.js): a cookie the
// framed site set as SameSite=Lax/Strict or unmarked is stored again as SameSite=None; Secure, so Chrome
// sends it from a cross-site frame. Pure functions, no chrome.* here.

export const parseSetCookie = line => {
  const [pair, ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const c = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: {} };
  for (const a of attrs) {
    const i = a.indexOf('=');
    const k = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase();
    if (k) c.attrs[k] = i < 0 ? true : a.slice(i + 1).trim();
  }
  return c;
};

export const crossSiteCookie = (url, line, now = Date.now()) => {
  const c = parseSetCookie(line);
  if (!c || String(c.attrs.samesite || '').toLowerCase() === 'none') return null;
  const u = new URL(url);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname) || u.hostname.endsWith('.localhost');
  if (u.protocol !== 'https:' && !local) return null; // Secure cookies need a secure origin
  const out = { url: `${u.protocol}//${u.host}/`, name: c.name, value: c.value, path: c.attrs.path || '/', secure: true, httpOnly: !!c.attrs.httponly, sameSite: 'no_restriction' };
  if (typeof c.attrs.domain === 'string') out.domain = c.attrs.domain;
  const maxAge = Number(c.attrs['max-age']);
  if (c.attrs['max-age'] !== undefined && Number.isFinite(maxAge)) out.expirationDate = now / 1000 + maxAge;
  else if (typeof c.attrs.expires === 'string' && !Number.isNaN(Date.parse(c.attrs.expires))) out.expirationDate = Date.parse(c.attrs.expires) / 1000;
  return out;
};
