import { matchCompany, matchUserRule, resolveTarget } from '../../src/lib/rules.js';

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

print('All rule tests passed');
