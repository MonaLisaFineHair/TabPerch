import { useEffect, useState } from 'react';
import { isExtension } from './history.js';
import { clearSnapshots, disableSnapshots, enableSnapshots, snapshotSettings } from './snapshot-preview.js';

export default function SnapshotSettings({ onMessage }) {
  const [state, setState] = useState({ supported: isExtension(), enabled: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const sync = () => snapshotSettings().then(value => { if (!cancelled) setState(value); }).catch(() => {});
    sync();
    const changed = (changes, area) => { if (area === 'local' && changes.snapshotEnabled) sync(); };
    if (isExtension()) chrome.storage.onChanged.addListener(changed);
    if (isExtension()) { chrome.permissions.onAdded.addListener(sync); chrome.permissions.onRemoved.addListener(sync); }
    return () => {
      cancelled = true;
      if (isExtension()) {
        chrome.storage.onChanged.removeListener(changed);
        chrome.permissions.onAdded.removeListener(sync);
        chrome.permissions.onRemoved.removeListener(sync);
      }
    };
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (state.enabled) await disableSnapshots();
      else await enableSnapshots();
      setState(await snapshotSettings());
    } catch { onMessage('页面快照设置没有保存成功'); }
    finally { setBusy(false); }
  }

  return <>
    <label className="setting-row"><span>保存网页快照</span><input type="checkbox" checked={state.enabled} disabled={busy || !state.supported} onChange={toggle} /></label>
    <div className="setting-row"><span>本机页面快照</span><button className="text-button" onClick={async () => {
      try { await clearSnapshots(); onMessage('页面快照已清空'); } catch { onMessage('页面快照清理失败'); }
    }}>清除快照</button></div>
    <p className="snapshot-settings-note">主动启用并授权后，保存正常浏览时看到的画面，不读取 Cookie。最多 20 张、图片总量 10 MB、7 天过期；隐身窗口不记录。关闭后停止保存，已有快照可单独清除。</p>
  </>;
}
