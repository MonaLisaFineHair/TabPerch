import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
let chrome;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:4174')).ok) break; } catch {}
    if (i === 99) throw new Error('Production preview failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless', '--no-first-run'] });
  const connection = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const page = await connection.contexts()[0].newPage();
  await page.goto('http://127.0.0.1:4174');
  await fs.mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => localStorage.setItem('tab-out-preferences', JSON.stringify({ theme })), theme);
    const result = await lighthouse('http://127.0.0.1:4174', {
      port: chrome.port, output: ['html', 'json'], onlyCategories: ['performance', 'accessibility', 'best-practices'],
      disableStorageReset: true,
      formFactor: 'desktop', screenEmulation: { mobile: false, width: 1440, height: 1000, deviceScaleFactor: 1, disabled: false },
    });
    await fs.writeFile(`test-results/lighthouse-${theme}.html`, result.report[0]);
    await fs.writeFile(`test-results/lighthouse-${theme}.json`, result.report[1]);
    console.log(`${theme} theme:`);
    for (const [id, category] of Object.entries(result.lhr.categories)) {
      console.log(`  ${id}: ${Math.round(category.score * 100)}`);
      for (const item of category.auditRefs) {
        const audit = result.lhr.audits[item.id];
        if (item.weight > 0 && audit.score !== null && audit.score < 1) console.log(`    ${item.id}: ${audit.title}`);
      }
    }
  }
} finally {
  await chrome?.kill();
  server.kill();
}
