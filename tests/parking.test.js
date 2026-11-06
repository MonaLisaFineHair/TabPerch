import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deleteParkedPage, normalizeParkedPage, readParkedPages, saveParkedPage } from '../src/parking.js';
import { layoutParkedPages } from '../src/hanging-layout.js';

afterEach(() => { delete globalThis.chrome; delete globalThis.localStorage; });

function storageFixture() {
  const values = { preferences: { period: 'today' } };
  globalThis.chrome = {
    runtime: { id: 'fixture' }, history: {},
    storage: { local: {
      get: async () => ({ ...values }),
      set: async entries => Object.assign(values, entries),
      remove: async key => { delete values[key]; },
    } },
  };
  return values;
}

test('parking rejects non-web addresses and keeps only bounded display and position data', () => {
  for (const url of ['javascript:alert(1)', 'chrome://history', 'data:text/html,hi', 'invalid']) assert.equal(normalizeParkedPage({ url }), null);
  const page = normalizeParkedPage({ url: 'https://a.test/?utm_source=mail#intro', title: '  A page  ', side: 'wrong', x: 99, y: -10, count: 999, logo: '../../other' });
  assert.equal(page.id, 'https://a.test/');
  assert.equal(page.title, 'A page');
  assert.equal(page.side, 'left');
  assert.equal(page.x, 1);
  assert.equal(page.y, 18);
  assert.equal(page.count, undefined);
  assert.equal(page.logo, undefined);
});

test('moving an existing canonical page updates one record instead of creating a duplicate', async () => {
  storageFixture();
  await saveParkedPage({ url: 'https://a.test/?utm_source=mail', title: 'First', side: 'left', x: .3, y: 70, savedAt: 1 });
  await saveParkedPage({ url: 'https://a.test/#section', title: 'Updated', side: 'right', x: .7, y: 220, savedAt: 1 });
  const pages = await readParkedPages();
  assert.equal(pages.length, 1);
  assert.equal(pages[0].side, 'right');
  assert.equal(pages[0].title, 'Updated');
  assert.equal(pages[0].y, 220);
});

test('independent page keys preserve other pins and preferences when saving and removing', async () => {
  const values = storageFixture();
  await Promise.all([
    saveParkedPage({ url: 'https://a.test/', title: 'A', savedAt: 1 }),
    saveParkedPage({ url: 'https://b.test/', title: 'B', savedAt: 2 }),
  ]);
  assert.equal((await readParkedPages()).length, 2);
  await deleteParkedPage('https://a.test/');
  assert.equal((await readParkedPages())[0].url, 'https://b.test/');
  assert.deepEqual(values.preferences, { period: 'today' });
});

test('wide hanging areas use multiple columns and retain full note size when there is room', () => {
  const pages = Array.from({ length: 4 }, (_, index) => ({ id: String(index), x: .5, y: index * 200 }));
  const layout = layoutParkedPages(pages, 420, 720);
  assert.equal(layout.length, 4);
  assert.ok(new Set(layout.map(item => item.x)).size >= 2);
  assert.ok(layout.every(item => item.width === 128 && item.height === 126));
});

test('dense sets shrink to fit every note in the visible region without overlap', () => {
  for (const count of [4, 24, 80, 300]) {
    const pages = Array.from({ length: count }, (_, index) => ({ id: String(index), x: .5, y: index * 10000 }));
    const layout = layoutParkedPages(pages, 240, 480);
    assert.equal(layout.length, count);
    for (const item of layout) {
      assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= 240 && item.y + item.height <= 480);
    }
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i], b = layout[j];
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
    }
    if (count > 4) assert.ok(layout[0].width < 128);
  }
});

test('sparse manual notes retain drop locations, including after a viewport change', () => {
  const page = { id: 'a', manual: true, x: .7, yRatio: .65, y: 240 };
  const [large] = layoutParkedPages([page], 420, 720);
  const [small] = layoutParkedPages([page], 240, 480);
  assert.ok(Math.abs(large.x + large.width / 2 - 420 * .7) < 1);
  assert.ok(Math.abs(large.y + large.height / 2 - 720 * .65) < 1);
  assert.ok(Math.abs(small.y + small.height / 2 - 480 * .65) < 1);
});

test('preview storage survives rereads and skips damaged or unsafe records', async () => {
  const values = new Map([['parkedPage:broken', '{'], ['parkedPage:unsafe', JSON.stringify({ url: 'javascript:alert(1)' })]]);
  globalThis.localStorage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  await saveParkedPage({ url: 'https://kept.test/', title: 'Keep this', x: .4, y: 91, side: 'right' });
  const pages = await readParkedPages();
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'https://kept.test/');
  assert.equal(pages[0].y, 91);
  await deleteParkedPage(pages[0].id);
  assert.equal((await readParkedPages()).length, 0);
});
