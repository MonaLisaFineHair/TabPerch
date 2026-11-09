export const PERIODS = [
  { value: 'today', label: '今天' },
  { value: '3', label: '最近 3 天' },
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: 'all', label: '全部历史' },
];

export function periodStart(period, now = Date.now()) {
  if (period === 'today') {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return period === 'all' ? 0 : now - Number(period) * 86400000;
}

export const DEFAULT_PREFERENCES = { schemaVersion: 2, period: 'today', group: 'page', layout: 'grid', theme: 'system', limit: 24, showCounts: true, hidden: [] };

export function normalizePreferences(saved = {}) {
  const valid = { ...DEFAULT_PREFERENCES, ...saved, schemaVersion: 2 };
  // Switch existing installations to today's default once, then remember choices.
  if (saved.schemaVersion !== 2 || !PERIODS.some(period => period.value === valid.period)) valid.period = 'today';
  if (!['page', 'site'].includes(valid.group)) valid.group = 'page';
  if (!['grid', 'list'].includes(valid.layout)) valid.layout = 'grid';
  if (!['system', 'light', 'dark'].includes(valid.theme)) valid.theme = 'system';
  if (![24, 48, 96].includes(valid.limit)) valid.limit = 24;
  valid.hidden = Array.isArray(valid.hidden) ? [...new Set(valid.hidden.filter(key => typeof key === 'string').map(key =>
    key.startsWith('page:') ? `page:${pageKey(key.slice(5))}` : key
  ))] : [];
  return valid;
}

export function webUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function visitsInPeriod(visits, startTime, endTime) {
  // visitCount on HistoryItem is lifetime-wide; never use it for a date range.
  return visits.filter(visit => visit.visitTime >= startTime && visit.visitTime <= endTime &&
    visit.transition !== 'auto_subframe' && visit.transition !== 'manual_subframe');
}

export function pageKey(value) {
  const url = webUrl(value);
  if (!url) return value;
  for (const name of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(name) || /^(fbclid|gclid|dclid|msclkid|_ga|_gl|mc_cid|mc_eid)$/i.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  // Ordinary anchors identify a section; / and ! hashes commonly identify SPA routes.
  if (url.hash && !/^#(?:\/|!)/.test(url.hash)) url.hash = '';
  return url.href;
}

export function groupEntries(entries, group = 'page') {
  const pages = new Map();
  for (const entry of entries) {
    if (!webUrl(entry.url)) continue;
    const key = pageKey(entry.url);
    const current = pages.get(key);
    if (!current) pages.set(key, { ...entry, key, pages: 1 });
    else {
      const count = current.count + entry.count;
      if (entry.lastVisitTime > current.lastVisitTime) Object.assign(current, entry);
      current.count = count;
    }
  }
  if (group === 'page') return [...pages.values()];
  const groups = new Map();
  for (const entry of pages.values()) {
    const url = webUrl(entry.url);
    if (!url) continue;
    // Keep subdomains and ports distinct: different apps often share a parent domain.
    const key = url.host;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...entry, key, title: key.replace(/^www\./, ''), pages: 1 });
    } else {
      current.count += entry.count;
      current.pages += 1;
      if (entry.lastVisitTime > current.lastVisitTime) {
        current.url = entry.url;
        current.lastVisitTime = entry.lastVisitTime;
      }
    }
  }
  return [...groups.values()];
}

export function selectEntries(entries, { group = 'page', sort = 'frequency', query = '', hidden = [] } = {}) {
  const term = query.trim().toLocaleLowerCase();
  const excluded = new Set(hidden);
  return groupEntries(entries, group)
    .filter(entry => !excluded.has(`${group}:${entry.key}`))
    .filter(entry => !term || `${entry.title} ${entry.url}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === 'recent'
      ? b.lastVisitTime - a.lastVisitTime || b.count - a.count || a.key.localeCompare(b.key)
      : b.count - a.count || b.lastVisitTime - a.lastVisitTime || a.key.localeCompare(b.key));
}

export const isExtension = () => Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.history);

export async function readPreferences() {
  if (isExtension()) return (await chrome.storage.local.get('preferences')).preferences || {};
  try { return JSON.parse(localStorage.getItem('tab-out-preferences') || '{}'); }
  catch { return {}; }
}

export async function savePreferences(preferences) {
  if (isExtension()) await chrome.storage.local.set({ preferences });
  else localStorage.setItem('tab-out-preferences', JSON.stringify(preferences));
}

export async function readHistory(period, { onProgress = () => {}, signal, force = false } = {}) {
  if (!isExtension()) {
    const { demoEntries } = await import('./preview.js');
    return { entries: demoEntries(period), truncated: false, fetchedAt: Date.now() };
  }
  const abort = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
  const endTime = Date.now();
  const startTime = periodStart(period, endTime);
  const cacheKey = `historyCache:v3:${period}`;
  const storage = await chrome.storage.session.get(['historyRevision', cacheKey]);
  const revision = storage.historyRevision;
  const cache = storage[cacheKey];
  abort();
  if (!force && cache && cache.revision === revision &&
    (period !== 'today' || cache.startTime === startTime) && endTime - cache.fetchedAt < 300000) return cache;

  // Page backward by lastVisitTime to avoid silently stopping at search's limit.
  const byUrl = new Map();
  let searchEnd = endTime;
  let truncated = false;
  const batchSize = 2000;
  const pageLimit = 50000;
  while (searchEnd >= startTime) {
    abort();
    const batch = await chrome.history.search({ text: '', startTime, endTime: searchEnd, maxResults: batchSize });
    abort();
    for (const item of batch) if (webUrl(item.url)) byUrl.set(item.url, item);
    if (batch.length < batchSize) break;
    const oldest = Math.min(...batch.map(item => item.lastVisitTime));
    if (!Number.isFinite(oldest) || oldest >= searchEnd || byUrl.size >= pageLimit) {
      truncated = true;
      break;
    }
    // Retain boundary timestamp for ties. If Chrome cannot advance, disclose truncation.
    searchEnd = oldest;
  }

  const items = [...byUrl.values()];
  let cursor = 0;
  let completed = 0;
  const entries = [];
  onProgress({ completed, total: items.length });
  await Promise.all(Array.from({ length: Math.min(12, items.length) }, async () => {
    while (cursor < items.length) {
      abort();
      const item = items[cursor++];
      const visits = visitsInPeriod(await chrome.history.getVisits({ url: item.url }), startTime, endTime);
      abort();
      if (visits.length) entries.push({
        url: item.url,
        title: item.title?.trim() || webUrl(item.url).host,
        count: visits.length,
        lastVisitTime: visits.reduce((latest, visit) => Math.max(latest, visit.visitTime), 0),
      });
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) onProgress({ completed, total: items.length });
    }
  }));
  abort();
  const currentRevision = (await chrome.storage.session.get('historyRevision')).historyRevision;
  const result = { entries, truncated, fetchedAt: endTime, startTime };
  // Do not cache a scan that overlapped navigation or history deletion.
  if (currentRevision === revision) {
    try {
      await chrome.storage.session.set({ [cacheKey]: { ...result, revision } });
    } catch {
      // Session quota is finite. Cache failure must not discard valid history.
    }
  }
  return result;
}
