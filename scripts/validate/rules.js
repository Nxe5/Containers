import { matchCompany, matchUserRule, resolveTarget, looksLikeAuthNavigation } from '../../src/lib/rules.js';

const domainData = {
  google: { label: 'Google', domains: ['google.com', 'youtube.com'] },
  meta:   { label: 'Meta',   domains: ['facebook.com', 'instagram.com'] },
};

const settings = {
  isolateUnmatched: true,
  companies: {
    google: { enabled: true, cookieStoreId: 'firefox-container-10' },
    meta:   { enabled: true, cookieStoreId: 'firefox-container-20' },
  },
  userRules: { 'work.example.com': 'firefox-container-30' },
  domainOverrides: {},
};

const state = { tempContainers: { 'firefox-container-99': {} }, hintedUrls: {} };

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

assert(matchCompany('mail.google.com', domainData, settings) === 'google', 'google suffix');
assert(matchCompany('GOOGLE.COM', domainData, settings) === 'google', 'case insensitive');
assert(matchCompany('m.instagram.com', domainData, settings) === 'meta', 'meta suffix');
assert(matchCompany('example.com', domainData, settings) === null, 'no match');

assert(matchUserRule('work.example.com', settings.userRules) === 'firefox-container-30', 'user rule exact');
assert(matchUserRule('sub.work.example.com', settings.userRules) === 'firefox-container-30', 'user rule suffix');

const r1 = resolveTarget({ hostname: 'youtube.com', currentCookieStoreId: 'firefox-default', domainData, settings, state });
assert(r1.cookieStoreId === 'firefox-container-10' && r1.reason === 'company:google', 'resolve google');

const r2 = resolveTarget({ hostname: 'unknown.test', currentCookieStoreId: 'firefox-default', domainData, settings, state });
assert(r2.createTemp && r2.reason === 'temporary', 'resolve temp');

const r3 = resolveTarget({ hostname: 'unknown.test', currentCookieStoreId: 'firefox-container-99', domainData, settings, state });
assert(r3.cookieStoreId === null && r3.reason === 'no-match', 'stay in temp');

const r4 = resolveTarget({ hostname: 'work.example.com', currentCookieStoreId: 'firefox-default', domainData, settings, state });
assert(r4.cookieStoreId === 'firefox-container-30' && r4.reason === 'user-rule', 'resolve user');

// stickyContainers: off by default, so all the above still apply unchanged.
// With it on, links stay in the current *named* container instead of moving
// to a matched company or the temp fallback — but a Temporary Container is
// still pass-through, and an explicit user rule still wins.
const stickySettings = { ...settings, stickyContainers: true };

const r5 = resolveTarget({
  hostname: 'unknown.test',
  currentCookieStoreId: 'firefox-container-10',
  domainData,
  settings: stickySettings,
  state,
});
assert(r5.cookieStoreId === 'firefox-container-10' && r5.reason === 'sticky', 'sticky beats temp fallback');

const r6 = resolveTarget({
  hostname: 'facebook.com',
  currentCookieStoreId: 'firefox-container-10',
  domainData,
  settings: stickySettings,
  state,
});
assert(r6.cookieStoreId === 'firefox-container-10' && r6.reason === 'sticky', 'sticky beats a different company match');

const r7 = resolveTarget({
  hostname: 'youtube.com',
  currentCookieStoreId: 'firefox-container-99',
  domainData,
  settings: stickySettings,
  state,
});
assert(r7.cookieStoreId === 'firefox-container-10' && r7.reason === 'company:google', 'sticky does not apply inside a temp container');

const r8 = resolveTarget({
  hostname: 'work.example.com',
  currentCookieStoreId: 'firefox-container-10',
  domainData,
  settings: stickySettings,
  state,
});
assert(r8.cookieStoreId === 'firefox-container-30' && r8.reason === 'user-rule', 'user rule still beats sticky');

const r9 = resolveTarget({
  hostname: 'youtube.com',
  currentCookieStoreId: 'firefox-default',
  domainData,
  settings: stickySettings,
  state,
});
assert(r9.cookieStoreId === 'firefox-container-10' && r9.reason === 'company:google', 'sticky does not block first entry from the default container');

// looksLikeAuthNavigation — the URL half of preserveAuthFlows (redirect-chain
// tracking, the other half, lives in the background engine and needs a live
// webRequest to exercise).
assert(looksLikeAuthNavigation('https://github.com/login/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fexample.com%2Fcb'), 'oauth authorize with params');
assert(looksLikeAuthNavigation('https://example.com/cb?response_type=code'), 'response_type param alone');
assert(looksLikeAuthNavigation('https://idp.example.com/x?SAMLRequest=abc'), 'SAMLRequest param');
assert(looksLikeAuthNavigation('https://accounts.example.com/signin'), 'signin path segment');
assert(looksLikeAuthNavigation('https://example.com/auth/v1/callback'), 'auth path segment mid-path');
assert(looksLikeAuthNavigation('https://github.com/login'), 'login path at end');
assert(!looksLikeAuthNavigation('https://example.com/blog/login-tips'), 'segment-anchored: /blog/login-tips is not auth');
assert(!looksLikeAuthNavigation('https://github.com/user/repo'), 'plain repo page is not auth');
assert(!looksLikeAuthNavigation('https://example.com/?q=client_id'), 'client_id alone without redirect_uri is not auth');
assert(!looksLikeAuthNavigation('not a url'), 'garbage input is not auth');

console.log('All rule tests passed');
