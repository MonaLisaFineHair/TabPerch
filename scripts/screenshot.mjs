import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });

const parked = [
  { url: 'https://github.com/', title: 'GitHub · Where the world builds software', logo: 'github', side: 'left', yRatio: .16 },
  { url: 'https://chatgpt.com/', title: 'ChatGPT', logo: 'chatgpt', side: 'left', yRatio: .40 },
  { url: 'https://www.notion.so/', title: 'Notion · 我的笔记', logo: 'notion', side: 'right', yRatio: .10 },
  { url: 'https://www.figma.com/', title: 'Figma · Design together', logo: 'figma', side: 'right', yRatio: .42 },
].map((page, index) => ({ ...page, x: .5, y: 24, manual: false, savedAt: index + 1 }));

let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* Server still starting. */ }
    if (i === 99) throw new Error('Run `npm run build` before taking screenshots');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  await mkdir('docs', { recursive: true });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, deviceScaleFactor: 2, colorScheme: theme });
    await context.addInitScript(({ theme, parked }) => {
      localStorage.setItem('tab-out-preferences', JSON.stringify({ schemaVersion: 2, period: '30', group: 'page', layout: 'grid', theme, limit: 24, showCounts: true, hidden: [] }));
      for (const page of parked) localStorage.setItem(`parkedPage:${page.url}`, JSON.stringify(page));
    }, { theme, parked });
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForSelector('.page-card');
    await page.waitForFunction(count => document.querySelectorAll('.hanging-note').length === count, parked.length);
    await page.addStyleTag({ content: '.preview-label, .preview-note { display: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `docs/screenshot-${theme}.png` });
    await context.close();
    console.log(`docs/screenshot-${theme}.png`);
  }
} finally {
  await browser?.close();
  server.kill();
}
