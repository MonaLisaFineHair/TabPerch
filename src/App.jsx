import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise, ArrowUpRight, ChartBar, Check, Clock, EyeSlash,
  Globe, GridFour, List, MagnifyingGlass, Paperclip, ShieldCheck, SlidersHorizontal,
  X,
} from '@phosphor-icons/react';
import {
  DEFAULT_PREFERENCES, PERIODS, isExtension, normalizePreferences, pageKey, readHistory, readPreferences,
  savePreferences, selectEntries, webUrl,
} from './history.js';
import HangingZone, { beginCardDrag, positionAtDrop, readCardDrag } from './HangingZone.jsx';
import PagePreview, { requestPagePreview } from './PagePreview.jsx';
import SnapshotSettings from './SnapshotSettings.jsx';
import PreviewBoundary from './PreviewBoundary.jsx';
import { PARK_DRAG_TYPE, deleteParkedPage, normalizeParkedPage, readParkedPages, saveParkedPage, subscribeParkedPages } from './parking.js';

const number = value => new Intl.NumberFormat('zh-CN').format(value);

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function PageIcon({ entry, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const source = isExtension()
    ? `${chrome.runtime.getURL('_favicon/')}?pageUrl=${encodeURIComponent(entry.url)}&size=128`
    : entry.logo ? `${import.meta.env.BASE_URL}preview-icons/${entry.logo}.svg` : null;
  return <div className="page-icon" style={{ width: size, height: size }} aria-hidden="true">
    {source && !failed
      ? <img src={source} alt="" draggable={false} width={size} height={size} onError={() => setFailed(true)} />
      : <span className="letter-icon" style={{ fontSize: size * .52 }}>{webUrl(entry.url)?.hostname.replace(/^www\./, '').slice(0, 1).toUpperCase() || <Globe />}</span>}
  </div>;
}

function PageCard({ entry, rank, showCounts, onHide, parked, onPark, onRemove, onDragging, onPreview }) {
  const host = webUrl(entry.url)?.host.replace(/^www\./, '');
  return <article className={`page-card ${rank === 0 ? 'first-card' : ''}`} draggable
    onDragStart={event => beginCardDrag(event, entry, 'history', onDragging)} onDragEnd={() => onDragging(null)}>
    <a href={entry.url} target="_blank" rel="noopener noreferrer" draggable={false} className="page-link" onClick={event => requestPagePreview(event, entry, onPreview)} title={`${entry.title}\n${entry.url}\n访问 ${entry.count} 次，最近访问：${relativeTime(entry.lastVisitTime)}`}>
      <div className="card-top">
        <PageIcon entry={entry} />
        <span className="card-rank">{String(rank + 1).padStart(2, '0')}</span>
      </div>
      <div className="card-description">
        <h2>{entry.title}</h2>
        <span className="card-domain">{host}</span>
      </div>
      <div className="card-bottom">
        <span className="card-count">{showCounts ? <><strong>{number(entry.count)}</strong> 次访问</> : relativeTime(entry.lastVisitTime)}</span>
        {(showCounts || entry.pages > 1) && <span className="card-time">{entry.pages > 1 ? `${entry.pages} 个网页` : relativeTime(entry.lastVisitTime)}</span>}
        <ArrowUpRight className="card-arrow" size={16} />
      </div>
    </a>
    <div className="card-actions">
      <button className={`park-button icon-button ${parked ? 'is-parked' : ''}`} aria-label={`${parked ? '取消暂存' : '暂存'} ${entry.title}`} aria-pressed={Boolean(parked)} title={parked ? '取消暂存' : '暂存'} onClick={() => parked ? onRemove(parked.id) : onPark(entry, 'left')}><Paperclip size={16} weight={parked ? 'bold' : 'regular'} /></button>
      <button className="hide-button icon-button" aria-label={`隐藏 ${entry.title}`} title="隐藏此入口" onClick={() => onHide(entry)}><EyeSlash size={16} /></button>
    </div>
  </article>;
}

export default function App() {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('frequency');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [toast, setToast] = useState(null);
  const [parkedPages, setParkedPages] = useState([]);
  const [dragging, setDragging] = useState(null);
  const [previewEntry, setPreviewEntry] = useState(null);
  const searchRef = useRef(null);
  const dialogRef = useRef(null);
  const previewDialogRef = useRef(null);
  const requestRef = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const parkQueue = useRef(Promise.resolve());
  const pendingParkWrites = useRef(0);
  const workspaceRef = useRef(null);
  const parkActionRef = useRef(null);
  const preview = !isExtension();

  useEffect(() => {
    let cancelled = false;
    const sync = () => readParkedPages().then(pages => {
      if (!cancelled && !pendingParkWrites.current) setParkedPages(previous => JSON.stringify(previous) === JSON.stringify(pages) ? previous : pages);
    }).catch(() => { if (!cancelled) setToast({ text: '暂存区读取失败，请刷新页面重试' }); });
    const unsubscribe = subscribeParkedPages(sync);
    sync();
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  function persistParkChange(operation) {
    pendingParkWrites.current++;
    parkQueue.current = parkQueue.current.catch(() => {}).then(operation).catch(async () => {
      setToast({ text: '暂存没有保存成功，请检查浏览器存储空间' });
    }).finally(async () => {
      pendingParkWrites.current--;
      if (!pendingParkWrites.current) {
        try {
          const pages = await readParkedPages();
          if (!pendingParkWrites.current) setParkedPages(pages);
        } catch { /* Keep the latest visible state. */ }
      }
    });
  }

  function park(entry, side, position) {
    const id = pageKey(entry.url);
    const previous = parkedPages.find(page => page.id === id);
    const page = normalizeParkedPage({ ...entry, ...(position || { x: .5, y: 24, yRatio: undefined }), manual: Boolean(position), side, savedAt: previous?.savedAt ?? entry.savedAt ?? Date.now() });
    if (!page) return;
    setParkedPages(pages => [...pages.filter(item => item.id !== page.id), page].sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id)));
    persistParkChange(() => saveParkedPage(page));
    setToast({ text: '已暂存' });
  }

  function removePark(id) {
    const previous = parkedPages.find(page => page.id === id);
    if (!previous) return;
    setParkedPages(pages => pages.filter(page => page.id !== id));
    persistParkChange(() => deleteParkedPage(id));
    setToast({ text: '已取消暂存', undoPark: previous });
  }
  parkActionRef.current = park;

  useEffect(() => {
    const sideAt = event => {
      const main = workspaceRef.current?.querySelector('.app-shell')?.getBoundingClientRect();
      if (!main || window.innerWidth < 640) return null;
      return event.clientX < main.left ? 'left' : event.clientX > main.right ? 'right' : null;
    };
    const over = event => {
      if (!event.dataTransfer.types.includes(PARK_DRAG_TYPE) || event.defaultPrevented) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = sideAt(event) ? 'move' : 'none';
    };
    const drop = event => {
      if (!event.dataTransfer.types.includes(PARK_DRAG_TYPE) || event.defaultPrevented) return;
      event.preventDefault();
      const payload = readCardDrag(event);
      const side = sideAt(event);
      const surface = side && workspaceRef.current?.querySelector(`.hanging-${side} .hanging-surface`);
      if (payload?.entry && surface) parkActionRef.current(payload.entry, side, positionAtDrop(surface, event));
      setDragging(null);
    };
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readPreferences().then(saved => {
      if (cancelled) return;
      setPreferences(normalizePreferences(saved));
      setReady(true);
    }).catch(() => {
      if (!cancelled) {
        setToast({ text: '设置读取失败，已使用默认设置' });
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const updatePreferences = useCallback(patch => setPreferences(previous => ({ ...previous, ...patch })), []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    if (!ready) return;
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => savePreferences(preferences)).catch(() => {
      setToast({ text: '设置保存失败，请检查浏览器存储空间' });
    });
  }, [preferences, ready]);

  const load = useCallback(async (force = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setProgress(null);
    setError('');
    try {
      const result = await readHistory(preferences.period, {
        force, signal: controller.signal,
        onProgress: value => { if (!controller.signal.aborted) setProgress(value); },
      });
      if (controller.signal.aborted) return;
      setEntries(result.entries);
      setTruncated(result.truncated);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError('无法读取访问记录。请确认插件已获得“读取浏览记录”权限，然后重试。');
      console.error('History read failed:', failure);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [preferences.period]);

  useEffect(() => {
    if (!ready) return;
    setEntries([]);
    load();
    let timer;
    let midnightTimer;
    const scheduleMidnight = () => {
      if (preferences.period !== 'today') return;
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = setTimeout(() => {
        setEntries([]);
        load(true);
        scheduleMidnight();
      }, nextMidnight.getTime() - Date.now() + 100);
    };
    scheduleMidnight();
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(true), 600);
    };
    const removed = () => {
      // Drop deleted records immediately, before the next asynchronous scan.
      requestRef.current?.abort();
      setEntries([]);
      setLoading(true);
      refresh();
    };
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', visible);
    if (!preview) {
      chrome.history.onVisited.addListener(refresh);
      chrome.history.onVisitRemoved.addListener(removed);
    }
    return () => {
      requestRef.current?.abort();
      clearTimeout(timer);
      clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', visible);
      if (!preview) {
        chrome.history.onVisited.removeListener(refresh);
        chrome.history.onVisitRemoved.removeListener(removed);
      }
    };
  }, [load, ready, preview, preferences.period]);

  useEffect(() => {
    const keydown = event => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable;
      if (event.key === '/' && !typing && !dialogRef.current?.open && !previewDialogRef.current?.open) {
        event.preventDefault(); searchRef.current?.focus();
      }
      if (event.key === 'Escape' && !dialogRef.current?.open && !previewDialogRef.current?.open) {
        setQuery(''); searchRef.current?.blur();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);

  const selected = useMemo(() => selectEntries(entries, {
    group: preferences.group, sort, query, hidden: preferences.hidden,
  }), [entries, preferences.group, preferences.hidden, sort, query]);
  const displayed = selected.slice(0, preferences.limit);
  const leftParkedPages = useMemo(() => parkedPages.filter(page => page.side === 'left'), [parkedPages]);
  const rightParkedPages = useMemo(() => parkedPages.filter(page => page.side === 'right'), [parkedPages]);
  const totalVisits = entries.reduce((sum, entry) => sum + entry.count, 0);
  const siteCount = new Set(entries.map(entry => webUrl(entry.url)?.host)).size;
  const periodLabel = PERIODS.find(period => period.value === preferences.period)?.label;

  function hide(entry) {
    const key = `${preferences.group}:${entry.key}`;
    updatePreferences({ hidden: [...new Set([...preferences.hidden, key])] });
    setToast({ text: '已隐藏此入口', undoKey: key });
  }

  return <div ref={workspaceRef} className={`workspace ${dragging ? 'is-dragging' : ''}`}>
    <div className="app-shell">
    <main>
      <section className="intro" aria-labelledby="page-title">
        <div className="intro-heading">
          <h1 id="page-title">常去的地方，<span>一眼找到。</span></h1>
          <div className="topbar-actions">
            <button className="icon-button" title="刷新访问记录" aria-label="刷新访问记录" disabled={loading} onClick={() => load(true)}><ArrowClockwise size={20} /></button>
            <button className="icon-button" title="显示设置" aria-label="显示设置" onClick={() => dialogRef.current.showModal()}><SlidersHorizontal size={20} /></button>
          </div>
        </div>
        <div className="intro-subline"><p className="intro-subtitle">从上次停留的地方，继续。</p>{preview && <span className="preview-label">预览模式 · 示例数据</span>}</div>
        <form className="search-box" role="search" onSubmit={event => { event.preventDefault(); if (displayed[0]) setPreviewEntry(displayed[0]); }}>
          <MagnifyingGlass size={22} aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="搜索访问记录" placeholder="搜索网页标题或网址" value={query} onChange={event => setQuery(event.target.value)} />
          {query ? <button className="icon-button" type="button" aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current.focus(); }}><X size={17} /></button> : <kbd>/</kbd>}
        </form>
      </section>

      <section aria-label="访问记录" className={`history-section ${dragging?.kind === 'parked' ? 'return-ready' : ''}`}
        onDragOver={event => { if (dragging?.kind === 'parked' && event.dataTransfer.types.includes(PARK_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => {
          const payload = readCardDrag(event);
          if (payload?.kind !== 'parked') return;
          event.preventDefault();
          removePark(payload.entry.id);
          setDragging(null);
        }}>
        <div className="toolbar">
          <div className="sort-tabs" role="group" aria-label="排序方式">
            <button aria-pressed={sort === 'frequency'} className={sort === 'frequency' ? 'active' : ''} onClick={() => setSort('frequency')}><ChartBar size={18} />经常访问</button>
            <button aria-pressed={sort === 'recent'} className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}><Clock size={18} />最近访问</button>
          </div>
          <div className="filters">
            <select aria-label="统计时间范围" value={preferences.period} onChange={event => updatePreferences({ period: event.target.value })}>{PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}</select>
            <select aria-label="分组方式" value={preferences.group} onChange={event => updatePreferences({ group: event.target.value })}><option value="page">按网页</option><option value="site">按网站</option></select>
            <div className="layout-switch" role="group" aria-label="显示方式">
              <button className="icon-button" aria-label="网格视图" aria-pressed={preferences.layout === 'grid'} onClick={() => updatePreferences({ layout: 'grid' })}><GridFour size={18} /></button>
              <button className="icon-button" aria-label="列表视图" aria-pressed={preferences.layout === 'list'} onClick={() => updatePreferences({ layout: 'list' })}><List size={19} /></button>
            </div>
          </div>
        </div>

        <div className="records-caption" aria-live="polite">
          <span>{loading ? progress ? `正在统计访问次数 ${progress.completed} / ${progress.total}` : '正在读取你的浏览足迹…' : <>{query ? '搜索结果' : periodLabel}<span className="caption-divider">/</span>{number(selected.length)} 个{preferences.group === 'page' ? '网页' : '网站'}</>}</span>
        </div>

        {error ? <div className="empty-state" role="alert"><Globe size={38} /><h2>浏览足迹暂时没有加载成功</h2><p>{error}</p><button className="primary-button" onClick={() => load(true)}>重新读取</button></div>
          : loading ? <div className="cards-grid skeleton-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton-card"><div className="skeleton-icon" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div>
          : displayed.length ? <div className={preferences.layout === 'grid' ? 'cards-grid' : 'cards-list'}>{displayed.map((entry, rank) => <PageCard key={`${preferences.group}:${entry.key}`} entry={entry} rank={rank} showCounts={preferences.showCounts} onHide={hide} parked={parkedPages.find(page => page.id === pageKey(entry.url))} onPark={park} onRemove={removePark} onDragging={setDragging} onPreview={setPreviewEntry} />)}</div>
          : <div className="empty-state"><MagnifyingGlass size={38} /><h2>{query ? '没有找到这个网页' : '这里等着你的下一次访问'}</h2><p>{query ? '试试其他标题或域名，也可以扩大统计时间范围。' : '浏览几个网页，再打开新标签页，你的常用入口就会出现在这里。'}</p>{query ? <button className="primary-button" onClick={() => setQuery('')}>清空搜索</button> : preferences.hidden.length > 0 && <button className="primary-button" onClick={() => updatePreferences({ hidden: [] })}>恢复隐藏的入口</button>}</div>}

        {!loading && !error && selected.length > displayed.length && <div className="show-more">显示前 {displayed.length} 个，共 {number(selected.length)} 个。<button onClick={() => dialogRef.current.showModal()}>调整显示数量</button></div>}
        {truncated && !loading && <p className="warning" role="status">历史记录较多，本次统计仅包含已读取的网页，排名可能不完整。缩短统计时间范围可以获得更完整的结果。</p>}
      </section>
    </main>

    <footer>
      <span className="privacy"><ShieldCheck size={16} />浏览足迹只留在这台设备</span>
      {!loading && !error && <span className="footer-summary">{periodLabel}<span>{number(totalVisits)} 次访问</span><span>{number(siteCount)} 个网站</span></span>}
    </footer>

    <dialog ref={dialogRef} className="settings-dialog" onClick={event => { if (event.target === event.currentTarget) dialogRef.current.close(); }}>
      <div className="dialog-heading"><div><h2>让这里更适合你</h2><p>显示设置会自动保存在本机。</p></div><button className="icon-button" aria-label="关闭设置" onClick={() => dialogRef.current.close()}><X size={22} /></button></div>
      <label className="setting-row"><span>页面主题</span><select aria-label="页面主题" value={preferences.theme} onChange={event => updatePreferences({ theme: event.target.value })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label className="setting-row"><span>最多显示</span><select aria-label="最多显示" value={preferences.limit} onChange={event => updatePreferences({ limit: Number(event.target.value) })}><option value={24}>24 个入口</option><option value={48}>48 个入口</option><option value={96}>96 个入口</option></select></label>
      <label className="setting-row"><span>显示访问次数</span><input type="checkbox" checked={preferences.showCounts} onChange={event => updatePreferences({ showCounts: event.target.checked })} /></label>
      <div className="setting-row"><span>已隐藏的入口 <small>{preferences.hidden.length}</small></span><button className="text-button" disabled={!preferences.hidden.length} onClick={() => { updatePreferences({ hidden: [] }); setToast({ text: '所有隐藏入口已恢复' }); }}>全部恢复</button></div>
      <SnapshotSettings onMessage={text => setToast({ text })} />
      <div className="settings-note"><ShieldCheck size={20} /><p>仅读取 Chrome 中的 HTTP / HTTPS 访问记录，不上传数据。隐藏入口不会删除浏览器历史。“按网站”合并相同主机和端口，并打开最近访问的网页。</p></div>
      {preview && <p className="preview-note">当前展示的是示例数据。将 dist 文件夹加载为 Chrome 扩展后，新标签页会显示你的真实访问记录。</p>}
    </dialog>

    </div>
    <HangingZone side="left" pages={leftParkedPages} dragging={dragging} onDragging={setDragging} onPark={park} onRemove={removePark} onPreview={setPreviewEntry} PageIcon={PageIcon} />
    <HangingZone side="right" pages={rightParkedPages} dragging={dragging} onDragging={setDragging} onPark={park} onRemove={removePark} onPreview={setPreviewEntry} PageIcon={PageIcon} />
    <PreviewBoundary resetKey={previewEntry?.url} onError={() => { setPreviewEntry(null); setToast({ text: '预览暂时无法加载，可使用 Ctrl / Command 点击直接打开网页' }); }}>
      <PagePreview entry={previewEntry} dialogRef={previewDialogRef} onClose={() => setPreviewEntry(null)} PageIcon={PageIcon} />
    </PreviewBoundary>
    <span className="sr-only" aria-live="polite">{dragging ? dragging.kind === 'parked' ? '可拖到另一侧，或拖回浏览记录取消暂存' : '可拖到左侧或右侧暂存区' : ''}</span>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast.text}</span>{toast.undoKey && <button onClick={() => { updatePreferences({ hidden: preferences.hidden.filter(key => key !== toast.undoKey) }); setToast(null); }}>撤销</button>}{toast.undoPark && <button onClick={() => { const page = toast.undoPark; park(page, page.side, page.manual ? { x: page.x, y: page.y, yRatio: page.yRatio } : undefined); }}>撤销</button>}<button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}
