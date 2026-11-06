import { useEffect, useLayoutEffect, useState } from 'react';
import { ArrowUpRight, ImageSquare, X } from '@phosphor-icons/react';
import { webUrl } from './history.js';
import { enableSnapshots, loadSnapshot, snapshotSettings } from './snapshot-preview.js';

export function requestPagePreview(event, entry, onPreview) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
  onPreview({ ...entry, anchor: { left, top, width, height } });
}

export default function PagePreview({ entry, dialogRef, onClose, PageIcon }) {
  const [onlineUrl, setOnlineUrl] = useState(null);
  const [image, setImage] = useState(null);
  const [capturedAt, setCapturedAt] = useState(null);
  const [settings, setSettings] = useState({ supported: false, enabled: false });
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const mode = onlineUrl === entry?.url ? 'online' : 'snapshot';
  const imageSource = image && entry && image.url === entry.url ? image.src : null;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!entry) { if (dialog.open) dialog.close(); return; }
    if (!dialog.open) dialog.show();
    const place = () => {
      const { width, height } = dialog.getBoundingClientRect();
      const anchor = entry.anchor || { left: (innerWidth - width) / 2, top: 72, width: 0, height: 0 };
      const left = Math.max(16, Math.min(anchor.left - 12, innerWidth - width - 16));
      const top = Math.max(16, Math.min(anchor.top - 10, innerHeight - height - 16));
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(dialog);
    window.addEventListener('resize', place);
    dialog.querySelector('[data-preview-open]')?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [entry, dialogRef]);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    let objectUrl;
    setOnlineUrl(null);
    setImage(null);
    setCapturedAt(null);
    setStatus('loading');
    Promise.all([loadSnapshot(entry.url), snapshotSettings()]).then(([snapshot, config]) => {
      if (cancelled) return;
      setSettings(config);
      if (snapshot) {
        objectUrl = URL.createObjectURL(snapshot.blob);
        setImage({ url: entry.url, src: objectUrl });
        setCapturedAt(snapshot.capturedAt);
      }
      setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('ready'); });
    const outside = event => {
      if (dialogRef.current.contains(event.target) || event.target.closest('.page-link, .hanging-link')) return;
      dialogRef.current.close();
    };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); dialogRef.current.close(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [entry, dialogRef]);

  function confirmOpen(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.open(entry.url, '_blank', 'noopener,noreferrer');
    dialogRef.current.close();
  }

  async function enable() {
    setBusy(true);
    try {
      if (await enableSnapshots()) setSettings(await snapshotSettings());
      else setStatus('permission-error');
    } catch { setStatus('permission-error'); }
    finally { setBusy(false); }
  }

  const site = entry && webUrl(entry.url);
  return <dialog ref={dialogRef} className="page-preview-dialog" aria-labelledby="preview-title" onClose={onClose}>
    {entry && <>
      <div className="page-preview-heading">
        <PageIcon entry={entry} size={32} />
        <div><h2 id="preview-title">{entry.title}</h2><span>{site?.host}</span></div>
        <button className="icon-button" aria-label="关闭网页预览" onClick={() => dialogRef.current.close()}><X size={18} /></button>
      </div>
      <details className="preview-address"><summary title={entry.url}>{site?.pathname}{site?.search}{site?.hash}</summary><p>{entry.url}</p></details>
      <div className="page-preview-content">
        {mode === 'snapshot' && imageSource && <>
          <img className="snapshot-image" src={imageSource} alt={`上次浏览 ${entry.title} 时的页面画面`} />
          <a className="page-preview-click" href={entry.url} target="_blank" rel="noopener noreferrer" onClick={confirmOpen} aria-label={`在新标签页打开 ${entry.title}`} title="打开网页" />
        </>}
        {mode === 'snapshot' && !imageSource && <div className="snapshot-empty">
          <ImageSquare size={30} weight="light" />
          <p>{status === 'loading' ? '正在取出页面快照…' : settings.enabled ? '还没有这页的快照' : '留住上次看到的页面'}</p>
          <span>{settings.enabled ? '在正常标签页浏览一次，下次就能在这里看见。' : '保留正常浏览时的画面，登录网站也能按当时的样子预览。'}</span>
          {!settings.enabled && settings.supported && <button className="snapshot-enable" disabled={busy} onClick={enable}>{busy ? '等待浏览器授权…' : '启用页面快照'}</button>}
          {status === 'permission-error' && <span>授权没有完成，也可以直接打开网页。</span>}
        </div>}
        {mode === 'online' && <>
          <iframe key={entry.url} src={entry.url} title={`网页内容预览：${entry.title}`} tabIndex={-1} aria-hidden="true" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
          <a className="page-preview-click" href={entry.url} target="_blank" rel="noopener noreferrer" onClick={confirmOpen} aria-label={`在新标签页打开 ${entry.title}`} title="打开网页" />
        </>}
      </div>
      <div className="page-preview-footer">
        <div><button className="preview-mode-button" onClick={() => setOnlineUrl(mode === 'snapshot' ? entry.url : null)}>{mode === 'snapshot' ? '在线预览' : '页面快照'}</button>
          {mode === 'snapshot' && imageSource && capturedAt && <span>保存于 {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(capturedAt)}</span>}
        </div>
        <a data-preview-open className="preview-open-button" href={entry.url} target="_blank" rel="noopener noreferrer" onClick={confirmOpen}>打开网页<ArrowUpRight size={16} /></a>
      </div>
      {mode === 'online' && <p className="preview-online-note">在线预览可能受网站登录或嵌入限制。正常打开后可保留真实快照。</p>}
    </>}
  </dialog>;
}
