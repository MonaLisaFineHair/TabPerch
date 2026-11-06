import { periodStart } from './history.js';

// Only loaded outside the extension. These are explicitly labelled sample records.
const samples = [
  ['GitHub · Where the world builds software', 'https://github.com/', 186, 3, 'github'],
  ['POPO 文档 · 我的工作空间', 'https://docs.popo.netease.com/', 124, 12, 'files'],
  ['ChatGPT', 'https://chatgpt.com/', 98, 24, 'chatgpt'],
  ['网易邮箱 · 收件箱', 'https://mail.163.com/', 76, 42, 'mail'],
  ['Figma · Design together', 'https://www.figma.com/', 61, 87, 'figma'],
  ['Notion · 我的笔记', 'https://www.notion.so/', 48, 120, 'notion'],
  ['MDN Web Docs', 'https://developer.mozilla.org/zh-CN/', 37, 165, 'mdn'],
  ['V2EX · 创意工作者们的社区', 'https://www.v2ex.com/', 29, 240, 'v2ex'],
  ['YouTube', 'https://www.youtube.com/', 24, 330, 'youtube'],
  ['掘金 · 代码不止，掘金不停', 'https://juejin.cn/', 19, 490, 'code'],
  ['TypeScript Documentation', 'https://www.typescriptlang.org/docs/', 16, 820, 'typescript'],
  ['少数派 · 高效工作，品质生活', 'https://sspai.com/', 12, 1440, 'sspai'],
  ['React · The library for web interfaces', 'https://react.dev/', 9, 1840, 'react'],
  ['Stack Overflow', 'https://stackoverflow.com/', 7, 2640, 'stack'],
  ['Wikipedia', 'https://zh.wikipedia.org/', 5, 3460, 'wiki'],
  ['Chrome for Developers', 'https://developer.chrome.com/', 3, 4230, 'chrome'],
];
export function demoEntries(period) {
  const now = Date.now();
  const multiplier = period === 'today' ? 0.5 : period === '3' ? 0.2 : period === '7' ? 0.3 : period === '90' ? 2.4 : period === 'all' ? 4.7 : 1;
  return samples.map(([title, url, count, minutes, logo]) => ({
    title, url, count: Math.max(1, Math.round(count * multiplier)),
    lastVisitTime: now - minutes * 60000, logo,
  })).filter(entry => entry.lastVisitTime >= periodStart(period, now));
}
