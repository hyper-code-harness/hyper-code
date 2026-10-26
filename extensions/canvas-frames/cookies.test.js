// bun test ./extensions/canvas-frames — the cookie rewrite the worker applies to frames in Hyper tabs.
import { expect, test } from 'bun:test';
import { crossSiteCookie, parseSetCookie } from './cookies.js';

test('a Lax session cookie from a local http service becomes SameSite=None; Secure', () => {
  expect(crossSiteCookie('http://localhost:8765/auth/login', 'ssid=abc; Path=/; HttpOnly; SameSite=Lax'))
    .toEqual({ url: 'http://localhost:8765/', name: 'ssid', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction' });
});

test('unmarked cookies (Lax by default) on https keep domain and lifetime', () => {
  const c = crossSiteCookie('https://app.example.com/x', 'sid=1; Domain=.example.com; Max-Age=60', 1_000_000);
  expect(c).toMatchObject({ url: 'https://app.example.com/', domain: '.example.com', expirationDate: 1060, sameSite: 'no_restriction', httpOnly: false });
});

test('cookies already SameSite=None and plain-http non-local sites are left alone', () => {
  expect(crossSiteCookie('https://a.com/', 'x=1; SameSite=None; Secure')).toBeNull();
  expect(crossSiteCookie('http://a.com/', 'x=1; SameSite=Lax')).toBeNull();
  expect(parseSetCookie('garbage')).toBeNull();
});
