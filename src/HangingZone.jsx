import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowsLeftRight, Paperclip, X } from '@phosphor-icons/react';
import { PARK_DRAG_TYPE, noteTilt } from './parking.js';
import { layoutParkedPages } from './hanging-layout.js';
import { webUrl } from './history.js';

export function beginCardDrag(event, entry, kind, onDragging) {
  if (event.target.closest('button')) { event.preventDefault(); return; }
  event.dataTransfer.clearData();
  event.dataTransfer.setData(PARK_DRAG_TYPE, JSON.stringify({ entry, kind }));
  event.dataTransfer.effectAllowed = kind === 'parked' ? 'move' : 'copyMove';
  const bounds = event.currentTarget.getBoundingClientRect();
  event.dataTransfer.setDragImage(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top);
  onDragging({ id: entry.id || entry.url, kind });
}

export function positionAtDrop(surface, event) {
  const bounds = surface.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / Math.max(1, bounds.width),
    y: event.clientY - bounds.top - 63,
    yRatio: (event.clientY - bounds.top) / Math.max(1, bounds.height),
  };
}

export function readCardDrag(event) {
  try { return JSON.parse(event.dataTransfer.getData(PARK_DRAG_TYPE)); } catch { return null; }
}

export default function HangingZone({ side, pages, dragging, onDragging, onPark, onRemove, PageIcon }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const surfaceRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const layout = useMemo(() => layoutParkedPages(pages, size.width, size.height), [pages, size]);
  const accepts = event => event.dataTransfer.types.includes(PARK_DRAG_TYPE);
  useEffect(() => {
    if (!dragging) { depth.current = 0; setOver(false); }
  }, [dragging]);
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const measure = () => {
      const { width, height } = surface.getBoundingClientRect();
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  function drop(event) {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readCardDrag(event);
    const position = positionAtDrop(surfaceRef.current, event);
    if (payload?.entry) onPark(payload.entry, side, position);
    onDragging(null);
    depth.current = 0;
    setOver(false);
  }

  return <aside className={`hanging-zone hanging-${side} ${dragging ? 'drag-ready' : ''} ${over ? 'drop-over' : ''}`} aria-label={`${side === 'left' ? '左' : '右'}侧暂存区`}
    onDragEnter={event => { if (accepts(event)) { event.preventDefault(); depth.current++; setOver(true); } }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
    onDragOver={event => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragging?.kind === 'parked' ? 'move' : 'copy';
    }} onDrop={drop}>
      <div className="hanging-surface" ref={surfaceRef}>
        {layout.map(({ page, x, y, width, height, scale }) => <article key={page.id} className={`hanging-note ${scale < .84 ? 'is-compact' : ''} ${scale < .52 ? 'is-tiny' : ''}`} data-page-id={page.id} draggable
          style={{ '--note-left': `${x}px`, '--note-top': `${y}px`, '--note-width': `${width}px`, '--note-height': `${height}px`, '--note-scale': scale, '--note-tilt': `${noteTilt(page.id)}deg` }}
          onDragStart={event => beginCardDrag(event, page, 'parked', onDragging)} onDragEnd={() => onDragging(null)}>
          <span className="note-clip" aria-hidden="true"><Paperclip size={25} weight="bold" /></span>
          <a href={page.url} target="_blank" rel="noopener noreferrer" draggable={false} className="hanging-link" aria-label={page.title} title={`${page.title}\n${page.url}`}>
            <PageIcon entry={page} size={Math.min(24, Math.max(10, 24 * scale))} />
            <h2>{page.title}</h2>
            <span>{webUrl(page.url)?.host.replace(/^www\./, '')}</span>
          </a>
          <div className="note-actions">
            <button className="icon-button" aria-label={`移到另一侧 ${page.title}`} title="挂到另一侧" onClick={() => onPark(page, side === 'left' ? 'right' : 'left')}><ArrowsLeftRight size={14} /></button>
            <button className="icon-button" aria-label={`取消暂存 ${page.title}`} title="取消暂存，也可拖回浏览记录" onClick={() => onRemove(page.id)}><X size={14} /></button>
          </div>
        </article>)}
      </div>
  </aside>;
}
