import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
const profile = await mkdtemp(path.join(tmpdir(), 'tab-out-test-'));
let browser;
let extension;
const errors = [];
await mkdir('test-results', { recursive: true });

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:4173')).ok) break; } catch {}
    if (i === 99) throw new Error('Preview server failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByLabel('统计时间范围')).toHaveValue('today');
  await expect(page.getByLabel('统计时间范围').getByRole('option', { name: '今天', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('统计时间范围').getByRole('option', { name: '最近 3 天', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Tab Out 首页' })).toHaveCount(0);
  await expect(page.getByText('你的浏览足迹', { exact: true })).toHaveCount(0);
  await page.getByLabel('统计时间范围').selectOption('30');
  await expect(page.locator('.page-card')).toHaveCount(16);
  await expect(page.getByText('预览模式 · 示例数据')).toBeVisible();
  await expect(page.locator('.page-card').first()).toContainText('186');
  await expect(page.locator('.page-icon img').first()).toBeVisible();
  const cardSizes = await page.locator('.page-card').evaluateAll(cards => cards.map(card => {
    const { width, height } = card.getBoundingClientRect();
    return { width, height };
  }));
  expect(cardSizes.every(card => Math.abs(card.width - cardSizes[0].width) < 1 && card.height === cardSizes[0].height)).toBe(true);
  expect(await page.locator('.page-card .page-icon').evaluateAll(icons => icons.every(icon => icon.getBoundingClientRect().width === 40))).toBe(true);
  const positions = await page.locator('.page-card').evaluateAll(cards => cards.map(card => {
    const { x, y } = card.getBoundingClientRect();
    return { x, y };
  }));
  expect(positions.every((position, i) => !i || position.y > positions[i - 1].y || position.y === positions[i - 1].y && position.x > positions[i - 1].x)).toBe(true);
  await page.context().route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Opened page fixture</title>' }));

  const leftSurface = page.locator('.hanging-left .hanging-surface');
  const rightSurface = page.locator('.hanging-right .hanging-surface');
  const githubNote = page.locator('.hanging-note[data-page-id="https://github.com/"]');
  await page.locator('.page-card').first().dragTo(leftSurface, { targetPosition: { x: 80, y: 165 } });
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(1);
  await expect(githubNote).toContainText('GitHub');
  await page.locator('.page-card').nth(1).dragTo(rightSurface, { targetPosition: { x: 85, y: 348 } });
  await expect(page.locator('.hanging-note')).toHaveCount(2);
  await expect(page.locator('.page-card')).toHaveCount(16);

  const originalTop = (await githubNote.boundingBox()).y;
  await githubNote.dragTo(leftSurface, { targetPosition: { x: 90, y: 335 } });
  expect((await githubNote.boundingBox()).y).toBeGreaterThan(originalTop + 80);
  await githubNote.dragTo(rightSurface, { targetPosition: { x: 70, y: 150 } });
  await expect(page.locator('.hanging-right .hanging-note')).toHaveCount(2);
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(0);

  await githubNote.dragTo(page.getByLabel('访问记录', { exact: true }), { targetPosition: { x: 100, y: 90 } });
  await expect(page.locator('.hanging-note')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.hanging-note')).toHaveCount(2);
  await githubNote.hover();
  await githubNote.getByRole('button', { name: /^移到另一侧/ }).click();
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(1);
  await page.getByRole('button', { name: '暂存 Notion · 我的笔记', exact: true }).click();
  await expect(page.locator('.hanging-note')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.page-card')).toHaveCount(16);
  await expect(page.locator('.hanging-note')).toHaveCount(3);

  const sibling = await page.context().newPage();
  await sibling.goto('http://127.0.0.1:4173');
  await expect(sibling.locator('.hanging-note')).toHaveCount(3);
  await githubNote.hover();
  await githubNote.getByRole('button', { name: /^取消暂存/ }).click();
  await expect(sibling.locator('.hanging-note')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(sibling.locator('.hanging-note')).toHaveCount(3);
  await sibling.close();
  const parkedPopup = page.context().waitForEvent('page');
  await githubNote.getByRole('link').click();
  await expect(page.locator('.page-preview-dialog')).toBeHidden();
  const parkedOpened = await parkedPopup;
  await parkedOpened.waitForLoadState();
  expect(parkedOpened.url()).toBe('https://github.com/');
  expect(page.url()).toBe('http://127.0.0.1:4173/');
  await parkedOpened.close();
  if (await page.getByLabel('关闭提示', { exact: true }).isVisible()) await page.getByLabel('关闭提示', { exact: true }).click();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  console.log('PASS: drag to both sides, reposition, change sides, drag back, undo, keyboard/button alternative, persistence, cross-tab sync, pinned-page direct opening.');

  const clickedTab = page.context().waitForEvent('page');
  await page.locator('.page-link').first().click();
  await page.getByRole('link', { name: '打开网页', exact: true }).click();
  const opened = await clickedTab;
  await opened.waitForLoadState();
  expect(opened.url()).toBe('https://github.com/');
  expect(page.url()).toBe('http://127.0.0.1:4173/');
  await expect(page.locator('.page-card')).toHaveCount(16);
  await opened.close();

  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('react.dev');
  await expect(page.locator('.page-card')).toHaveCount(1);
  expect((await page.locator('.page-card').boundingBox()).width).toBeCloseTo(cardSizes[12].width, 0);
  expect(await page.locator('.page-card').evaluate(card => card.scrollHeight <= card.clientHeight + 2)).toBe(true);
  await page.getByRole('searchbox').fill('github');
  await expect(page.locator('.page-card')).toHaveCount(1);
  const submittedTab = page.context().waitForEvent('page');
  await page.getByRole('searchbox').press('Enter');
  await page.getByRole('link', { name: '打开网页', exact: true }).click();
  const submitted = await submittedTab;
  await submitted.waitForLoadState();
  expect(submitted.url()).toBe('https://github.com/');
  expect(page.url()).toBe('http://127.0.0.1:4173/');
  await submitted.close();
  await page.getByRole('searchbox').fill('a-website-that-does-not-exist');
  await expect(page.getByText('没有找到这个网页')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.page-card')).toHaveCount(16);
  await page.getByLabel('统计时间范围').selectOption('3');
  await expect(page.locator('.page-card').first()).toContainText('37');
  await expect(page.locator('.hanging-note')).toHaveCount(3);
  await page.getByLabel('统计时间范围').selectOption('7');
  await expect(page.locator('.page-card').first()).toContainText('56');
  await page.getByLabel('统计时间范围').selectOption('30');
  await page.getByLabel('分组方式').selectOption('site');
  await expect(page.locator('.page-card').first().locator('h2')).toHaveText('github.com');
  await page.getByLabel('分组方式').selectOption('page');
  await page.getByRole('button', { name: '最近访问', exact: true }).click();
  await expect(page.getByRole('button', { name: '最近访问', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '经常访问', exact: true }).click();

  await page.locator('.page-card').first().hover();
  await page.locator('.page-card').first().getByRole('button', { name: /^隐藏/ }).click();
  await expect(page.locator('.page-card')).toHaveCount(15);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.page-card')).toHaveCount(16);
  await page.getByLabel('列表视图', { exact: true }).click();
  await expect(page.locator('.cards-list')).toBeVisible();
  await expect(page.locator('.cards-grid')).toHaveCount(0);
  const rowSizes = await page.locator('.page-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height));
  expect(rowSizes.every(size => size === rowSizes[0])).toBe(true);
  expect(await page.locator('.page-card .page-icon').evaluateAll(icons => icons.every(icon => icon.getBoundingClientRect().width === 40))).toBe(true);
  await page.getByLabel('网格视图', { exact: true }).click();
  await page.getByLabel('显示设置', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('页面主题').selectOption('dark');
  await page.getByLabel('关闭设置', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/dark.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.page-card')).toHaveCount(16);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('显示设置', { exact: true }).click();
  await page.getByLabel('页面主题').selectOption('light');
  await page.getByLabel('关闭设置', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.page-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight + 2))).toBe(true);
  expect(await page.locator('.hanging-right').evaluate(zone => {
    const note = zone.querySelector('.hanging-note').getBoundingClientRect();
    const viewport = zone.querySelector('.hanging-surface').getBoundingClientRect();
    return note.top >= viewport.top && note.bottom <= viewport.bottom;
  })).toBe(true);
  await page.setViewportSize({ width: 715, height: 654 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const railLayout = await page.locator('.workspace').evaluate(workspace => {
    const left = workspace.querySelector('.hanging-left').getBoundingClientRect();
    const main = workspace.querySelector('.app-shell').getBoundingClientRect();
    const right = workspace.querySelector('.hanging-right').getBoundingClientRect();
    return left.right <= main.left && main.right <= right.left;
  });
  expect(railLayout).toBe(true);
  await page.screenshot({ path: 'test-results/compact.png', fullPage: true });
  for (const copy of ['待会再看', '随手一挂，下次还在', '拖一张卡片到这里', '拖到两侧保存']) {
    await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
  }
  const mobileCards = await page.locator('.page-card').evaluateAll(cards => cards.map(card => {
    const { width, height } = card.getBoundingClientRect();
    return { width, height };
  }));
  expect(mobileCards.every(card => Math.abs(card.width - mobileCards[0].width) < 1 && card.height === mobileCards[0].height)).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.page-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight + 2))).toBe(true);
  expect(errors).toEqual([]);
  console.log('PASS: preview interactions, persisted settings, light/dark, responsive layout.');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    const labels = ['接口参考', '开发笔记', '设计资料', '项目文档', '阅读清单', '周末再看'];
    const logos = ['github', 'mdn', 'figma', 'files', 'notion', 'youtube'];
    for (const [side, count] of [['left', 20], ['right', 12]]) {
      for (let i = 0; i < count; i++) {
        const url = `https://example.test/hang-${side}-${i}`;
        localStorage.setItem(`parkedPage:${url}`, JSON.stringify({ url, title: `${labels[i % labels.length]} ${i + 1}`, logo: logos[i % logos.length], side, x: .5, y: i * 1000, savedAt: i + 1 }));
      }
    }
  });
  await page.reload();
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(22);
  await expect(page.locator('.hanging-right .hanging-note')).toHaveCount(13);
  expect((await page.locator('.hanging-left').boundingBox()).width).toBeGreaterThan(300);
  expect(await page.locator('.hanging-left .hanging-note').evaluateAll(notes => new Set(notes.map(note => note.style.getPropertyValue('--note-left'))).size)).toBeGreaterThan(1);
  const expandedNoteWidth = await page.locator('.hanging-left .hanging-note').first().evaluate(note => note.clientWidth);

  const allNotesVisible = () => page.locator('.hanging-zone').evaluateAll(zones => zones.every(zone => {
    const surface = zone.querySelector('.hanging-surface');
    const bounds = surface.getBoundingClientRect();
    return surface.scrollHeight <= surface.clientHeight + 1 && surface.scrollWidth <= surface.clientWidth + 1 &&
      getComputedStyle(surface).overflowY === 'hidden' && [...zone.querySelectorAll('.hanging-note')].every(note => {
        const rect = note.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      });
  }));
  await expect.poll(allNotesVisible).toBe(true);
  await page.screenshot({ path: 'test-results/expanded.png', fullPage: true });
  await page.evaluate(() => {
    for (let i = 20; i < 100; i++) {
      const url = `https://example.test/hang-left-${i}`;
      localStorage.setItem(`parkedPage:${url}`, JSON.stringify({ url, title: `更多暂存 ${i}`, logo: 'files', side: 'left', x: .5, y: i * 1000, savedAt: i + 1 }));
    }
  });
  await page.reload();
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(102);
  await expect.poll(allNotesVisible).toBe(true);
  expect(await page.locator('.hanging-left .hanging-note').first().evaluate(note => note.clientWidth)).toBeLessThan(expandedNoteWidth);
  await page.screenshot({ path: 'test-results/dense.png', fullPage: true });
  await page.locator('.hanging-left .hanging-note').first().hover();
  await page.locator('.hanging-left .hanging-note').first().getByRole('button', { name: /^取消暂存/ }).click();
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(101);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.hanging-left .hanging-note')).toHaveCount(102);
  console.log('PASS: expanded multi-column hanging areas, hidden hints, all 115 notes visible without internal scrolling, adaptive shrinking and dense-note controls.');

  const extensionPath = path.resolve('dist');
  extension = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1440, height: 1000 },
  });
  const worker = extension.serviceWorkers()[0] || await extension.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const fixtureUrl = 'https://tab-out-fixture.example/work';
  await worker.evaluate(async url => {
    // This is an isolated temporary profile, never the user's Chrome history.
    await chrome.storage.local.set({ preferences: { period: '30', theme: 'light' } });
    await chrome.history.deleteAll();
    await chrome.history.addUrl({ url });
    await chrome.history.addUrl({ url });
    await chrome.history.addUrl({ url: 'https://tab-out-fixture.example/notes' });
  }, fixtureUrl);
  const newTab = await extension.newPage();
  newTab.on('pageerror', error => errors.push(error.message));
  await newTab.goto('chrome://newtab/');
  await expect(newTab.getByRole('heading', { name: '常去的地方，一眼找到。' })).toBeVisible();
  await expect(newTab.getByLabel('统计时间范围')).toHaveValue('today');
  await expect(newTab.locator('.page-card')).toHaveCount(2);
  await expect(newTab.getByText('预览模式 · 示例数据')).toHaveCount(0);
  const actualVisits = await worker.evaluate(url => chrome.history.getVisits({ url }), fixtureUrl);
  await expect(newTab.locator(`a[href="${fixtureUrl}"] .card-count`)).toContainText(String(actualVisits.length));
  const navigationUrl = newTab.url();
  await extension.route('https://tab-out-fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>New tab fixture</title>' }));
  const extensionPopup = extension.waitForEvent('page');
  await newTab.locator(`a[href="${fixtureUrl}"]`).click();
  await newTab.getByRole('link', { name: '打开网页', exact: true }).click();
  const fixtureTab = await extensionPopup;
  await fixtureTab.waitForLoadState();
  expect(fixtureTab.url()).toBe(fixtureUrl);
  expect(newTab.url()).toBe(navigationUrl);
  await fixtureTab.close();
  await worker.evaluate(() => chrome.history.addUrl({ url: 'https://tab-out-fixture.example/notes?utm_source=fixture#summary' }));
  await newTab.getByLabel('刷新访问记录', { exact: true }).click();
  await expect(newTab.locator('.page-card')).toHaveCount(2);
  await newTab.getByLabel('分组方式').selectOption('site');
  await expect(newTab.locator('.page-card')).toHaveCount(1);
  await expect(newTab.locator('.page-card')).toContainText('2 个网页');
  await newTab.locator('.page-card').first().getByRole('button', { name: /^暂存 / }).click();
  await expect(newTab.locator('.hanging-note')).toHaveCount(1);
  await newTab.reload();
  await expect(newTab.locator('.hanging-note')).toHaveCount(1);
  await worker.evaluate(url => chrome.history.deleteUrl({ url }), fixtureUrl);
  await expect(newTab.locator(`a[href="${fixtureUrl}"]`)).toHaveCount(0);
  await worker.evaluate(() => chrome.history.deleteAll());
  await expect(newTab.getByText('这里等着你的下一次访问')).toBeVisible();
  await expect(newTab.locator('.hanging-note')).toHaveCount(1);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.version).toBe('1.6.2');
  expect(manifest.name).toBe('TabPerch');
  await expect(newTab).toHaveTitle('TabPerch · 常去的地方');
  expect(manifest.permissions).toEqual(['history', 'storage', 'favicon']);
  expect(errors).toEqual([]);
  console.log(`PASS: actual MV3 extension ${extensionId}, new-tab override, period counts, website grouping, history deletion.`);
} finally {
  await extension?.close();
  await browser?.close();
  server.kill();
  await rm(profile, { recursive: true, force: true });
}
