import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { groupEntries, normalizePreferences, pageKey, periodStart, readHistory, selectEntries, visitsInPeriod, webUrl } from '../src/history.js';

afterEach(() => { delete globalThis.chrome; });
const page = (url, count, lastVisitTime = 100) => ({ url, title: 'A page', count, lastVisitTime });

test('time windows count actual visits and include the boundaries', () => {
  const visits = [9, 10, 12, 20, 21].map(visitTime => ({ visitTime }));
  assert.equal(visitsInPeriod(visits, 10, 20).length, 3);
  assert.equal(periodStart('7', 8 * 86400000), 86400000);
  assert.equal(periodStart('all'), 0);
  assert.equal(periodStart('3', 8 * 86400000), 5 * 86400000);
});

test('today starts at local midnight rather than the last 24 hours', () => {
  const midday = new Date(2026, 10, 5, 14, 32).getTime();
  const midnight = new Date(2026, 10, 5, 0, 0).getTime();
  assert.equal(periodStart('today', midday), midnight);
  assert.equal(visitsInPeriod([
    { visitTime: midnight - 1 }, { visitTime: midnight }, { visitTime: midday }, { visitTime: midday + 1 },
  ], periodStart('today', midday), midday).length, 2);
});

test('existing preferences migrate to today once and preserve other user choices', () => {
  const upgraded = normalizePreferences({ period: '30', theme: 'dark', layout: 'list', hidden: ['page:https://example.com/?utm_source=mail#section'] });
  assert.equal(upgraded.period, 'today');
  assert.equal(upgraded.theme, 'dark');
  assert.equal(upgraded.layout, 'list');
  assert.deepEqual(upgraded.hidden, ['page:https://example.com/']);
  assert.equal(normalizePreferences({ ...upgraded, period: '3' }).period, '3');
  assert.equal(normalizePreferences().period, 'today');
});

test('only web URLs are navigable', () => {
  for (const value of ['javascript:alert(1)', 'chrome://history/', 'file:///x', 'broken', 'data:text/html,Hi']) assert.equal(webUrl(value), null);
  assert.equal(webUrl('http://localhost:5173/').port, '5173');
});

test('website grouping sums visits, preserves app boundaries, and opens latest page', () => {
  const grouped = groupEntries([
    page('https://example.com/a', 4, 10), page('http://example.com/b', 7, 20),
    page('https://app.example.com/', 3), page('http://localhost:3000/', 6), page('http://localhost:4000/', 8),
  ], 'site');
  assert.equal(grouped.length, 4);
  assert.deepEqual(grouped.find(entry => entry.key === 'example.com'), {
    url: 'http://example.com/b', title: 'example.com', count: 11, lastVisitTime: 20, key: 'example.com', pages: 2,
  });
});

test('ranking, tie-breaking, search, and hidden entries apply after grouping', () => {
  const entries = [page('https://a.test/', 5, 10), page('https://b.test/', 5, 20), page('https://c.test/', 4, 30)];
  assert.deepEqual(selectEntries(entries).map(entry => entry.key), ['https://b.test/', 'https://a.test/', 'https://c.test/']);
  assert.equal(selectEntries(entries, { sort: 'recent' })[0].key, 'https://c.test/');
  assert.equal(selectEntries(entries, { query: ' B.TEST ' }).length, 1);
  assert.equal(selectEntries(entries, { hidden: ['page:https://b.test/'] }).length, 2);
  assert.equal(selectEntries(entries, { group: 'site', hidden: ['site:b.test'] }).length, 2);
  // Exact page URLs preserve query strings and SPA hash routes.
  assert.equal(groupEntries([page('https://a.test/#/one', 2), page('https://a.test/#/two', 4)]).length, 2);
});

test('page deduplication combines anchors and trackers, sums visits, and uses latest title and URL', () => {
  const latest = 'https://a.test/report?utm_source=mail&id=1#summary';
  const entries = [
    { ...page('https://a.test/report?id=1#intro', 20, 10), title: 'Old report' },
    { ...page(latest, 70, 20), title: 'Latest report' },
    page('https://a.test/report?id=2', 4),
  ];
  const grouped = groupEntries(entries);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].count, 90);
  assert.equal(grouped[0].title, 'Latest report');
  assert.equal(grouped[0].url, latest);
  assert.equal(grouped[0].key, 'https://a.test/report?id=1');
  assert.equal(groupEntries(entries, 'site')[0].pages, 2);
  assert.equal(groupEntries(entries, 'site')[0].count, 94);
});

test('deduplication preserves business parameters, protocols, hosts, and SPA routes', () => {
  assert.equal(pageKey('https://a.test/?b=2&a=1&gclid=ad'), pageKey('https://a.test/?a=1&b=2'));
  const urls = [
    'https://a.test/?id=1', 'https://a.test/?id=2', 'https://a.test/#/one', 'https://a.test/#/two',
    'https://a.test/#!/one', 'https://a.test/#!/two', 'https://app.a.test/', 'http://a.test/',
  ];
  assert.equal(groupEntries(urls.map(url => page(url, 1))).length, urls.length);
  assert.equal(groupEntries(urls.map(url => ({ ...page(url, 1), title: 'Same title' }))).length, urls.length);
});

function mockChrome({ items, visits, revision = 'one', cacheFailure = false, search } = {}) {
  const store = { historyRevision: revision };
  let getVisitsCalls = 0;
  globalThis.chrome = {
    runtime: { id: 'test' },
    history: {
      search: search || (async () => items),
      getVisits: async ({ url }) => { getVisitsCalls++; return visits[url] || []; },
    },
    storage: { session: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])),
      set: async value => { if (cacheFailure) throw new Error('Quota exceeded'); Object.assign(store, value); },
    } },
  };
  return { store, calls: () => getVisitsCalls };
}

test('Chrome lifetime visitCount never leaks into period counts; cache invalidates on revision', async () => {
  const now = Date.now();
  const mock = mockChrome({
    items: [{ url: 'https://a.test/', title: 'A', visitCount: 999, lastVisitTime: now }, { url: 'chrome://newtab/' }],
    visits: { 'https://a.test/': [{ visitTime: now - 1000 }, { visitTime: now - 2 * 86400000 }, { visitTime: now - 60 * 86400000 }] },
  });
  const result = await readHistory('30');
  assert.equal(result.entries[0].count, 2);
  await readHistory('30');
  assert.equal(mock.calls(), 1);
  mock.store.historyRevision = 'two';
  await readHistory('30');
  assert.equal(mock.calls(), 2);
  await readHistory('30', { force: true });
  assert.equal(mock.calls(), 3);
});

test('quota failure preserves history and cancelled reads stop', async () => {
  mockChrome({ items: [{ url: 'https://a.test/' }], visits: { 'https://a.test/': [{ visitTime: Date.now() - 1000 }] }, cacheFailure: true });
  assert.equal((await readHistory('7')).entries.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readHistory('7', { signal: controller.signal }), { name: 'AbortError' });
});

test('today cache cannot cross midnight even within its five-minute lifetime', async () => {
  const originalNow = Date.now;
  const midnight = new Date(2026, 10, 6).getTime();
  let now = midnight - 1000;
  try {
    Date.now = () => now;
    const mock = mockChrome({ items: [{ url: 'https://a.test/' }], visits: { 'https://a.test/': [{ visitTime: midnight - 2000 }] } });
    assert.equal((await readHistory('today')).entries.length, 1);
    await readHistory('today');
    assert.equal(mock.calls(), 1);
    now = midnight + 1000;
    assert.equal((await readHistory('today')).entries.length, 0);
    assert.equal(mock.calls(), 2);
  } finally { Date.now = originalNow; }
});

test('history scan paginates and deduplicates timestamp boundaries', async () => {
  let queries = 0;
  const recent = Array.from({ length: 2000 }, (_, index) => ({ url: `https://a.test/${index}`, lastVisitTime: 10000 - index }));
  mockChrome({ visits: {}, search: async ({ endTime }) => {
    queries++;
    if (queries === 1) return recent;
    assert.equal(endTime, 8001);
    return [recent.at(-1), { url: 'https://older.test/', lastVisitTime: 1000 }];
  } });
  const result = await readHistory('all');
  assert.equal(queries, 2);
  assert.equal(result.truncated, false);
});

test('an unpageable boundary is disclosed as a partial ranking', async () => {
  const timestamp = Date.now() - 1000;
  const repeated = Array.from({ length: 2000 }, (_, index) => ({ url: `https://a.test/${index}`, lastVisitTime: timestamp }));
  mockChrome({ visits: {}, search: async () => repeated });
  assert.equal((await readHistory('all')).truncated, true);
});
