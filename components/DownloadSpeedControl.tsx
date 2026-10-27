import { t, translateMessage } from '../lib/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { DOWNLOAD_SPEED_KEY, DOWNLOAD_SPEEDS, downloadSpeed, type DownloadSpeed } from '../lib/downloadSpeed';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

const policies = Object.keys(DOWNLOAD_SPEEDS) as DownloadSpeed[];

export function useDownloadSpeed(preview = false, initialSpeed?: unknown) {
  const [speed, setSpeed] = useState<DownloadSpeed>(() => downloadSpeed(initialSpeed));
  const revision = useRef(0);
  useEffect(() => {
    if (preview) return;
    let live = true;
    const readRevision = revision.current;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (live && area === 'local' && changes[DOWNLOAD_SPEED_KEY]) {
        revision.current++;
        setSpeed(downloadSpeed(changes[DOWNLOAD_SPEED_KEY]!.newValue));
      }
    }
    async function read() {
      try {
        const values = await chrome.storage.local.get(DOWNLOAD_SPEED_KEY);
        if (live && revision.current === readRevision) setSpeed(downloadSpeed(values[DOWNLOAD_SPEED_KEY]));
      } catch { /* keep the default until storage becomes available */ }
    }
    chrome.storage.onChanged.addListener(changed);
    void read();
    return () => { live = false; chrome.storage.onChanged.removeListener(changed); };
  }, [preview]);
  async function change(value: string) {
    const next = downloadSpeed(value);
    const writeRevision = ++revision.current;
    if (!preview) await chrome.storage.local.set({ [DOWNLOAD_SPEED_KEY]: next });
    if (revision.current === writeRevision) setSpeed(next);
  }
  return { speed, change };
}

export function DownloadSpeedControl({ preview, initialSpeed, onError }: { preview: boolean; initialSpeed?: unknown; onError(message: string): void }) {
  const { speed, change } = useDownloadSpeed(preview, initialSpeed);
  const id = useId();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const policy = DOWNLOAD_SPEEDS[speed];
  async function commit(value: string) {
    if (!value || value === speed || pending.current) return;
    pending.current = true; setSaving(true);
    try { await change(value); }
    catch { onError(t("下载速度保存失败，请重试。")); }
    finally { pending.current = false; setSaving(false); }
  }
  return <section className="sidebar-group download-policy" aria-labelledby={`${id}-heading`}>
    <div className="sidebar-group-heading">
      <h3 id={`${id}-heading`}>{t("下载速度")}</h3>
      <span className="download-concurrency" id={`${id}-value`} title={t("每个来源最多 {0} 个并行下载", [policy.perOrigin])} aria-live="polite">{t("{0} 并发", [policy.perOrigin])}</span>
    </div>
    <ToggleGroup type="single" value={speed} onValueChange={value => void commit(value)} variant="outline" size="sm" spacing={0}
      className="download-speed-segments" disabled={saving} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-value`} aria-busy={saving}>
      {policies.map(key => <ToggleGroupItem key={key} value={key}
        className="min-w-0 flex-1 px-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        title={t("每个来源最多 {0} 个并行下载", [DOWNLOAD_SPEEDS[key].perOrigin])}>
        {key === 'medium' ? t('中') : translateMessage(DOWNLOAD_SPEEDS[key].label)}
      </ToggleGroupItem>)}
    </ToggleGroup>
  </section>;
}
