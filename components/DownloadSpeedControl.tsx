import { t, translateMessage } from '../lib/i18n';
import { useEffect, useId, useState } from 'react';
import { DOWNLOAD_SPEED_KEY, DOWNLOAD_SPEEDS, downloadSpeed, type DownloadSpeed } from '../lib/downloadSpeed';
import { Slider } from './ui/slider';

const policies = Object.keys(DOWNLOAD_SPEEDS) as DownloadSpeed[];

export function useDownloadSpeed(preview = false) {
  const [speed, setSpeed] = useState<DownloadSpeed>(() => downloadSpeed(undefined));
  useEffect(() => {
    if (preview) return;
    let live = true;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && changes[DOWNLOAD_SPEED_KEY]) setSpeed(downloadSpeed(changes[DOWNLOAD_SPEED_KEY]!.newValue));
    }
    async function read() {
      try {
        const values = await chrome.storage.local.get(DOWNLOAD_SPEED_KEY);
        if (live) setSpeed(downloadSpeed(values[DOWNLOAD_SPEED_KEY]));
      } catch { /* keep the default until storage becomes available */ }
    }
    chrome.storage.onChanged.addListener(changed);
    void read();
    return () => { live = false; chrome.storage.onChanged.removeListener(changed); };
  }, [preview]);
  async function change(value: string) {
    const next = downloadSpeed(value);
    if (!preview) await chrome.storage.local.set({ [DOWNLOAD_SPEED_KEY]: next });
    setSpeed(next);
  }
  return { speed, change };
}

export function DownloadSpeedControl({ preview, onError }: { preview: boolean; onError(message: string): void }) {
  const { speed, change } = useDownloadSpeed(preview);
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const index = draft ?? policies.indexOf(speed);
  const policy = DOWNLOAD_SPEEDS[policies[index]!];
  async function commit(values: number[]) {
    setSaving(true);
    try { await change(policies[values[0]!]!); }
    catch { onError(t("下载策略保存失败，请重试。")); }
    finally { setDraft(null); setSaving(false); }
  }
  return <section className="sidebar-group download-policy" aria-labelledby={`${id}-heading`}>
    <div className="sidebar-group-heading">
      <h3 id={`${id}-heading`}>{t("下载策略")}</h3>
      <span className="text-xs text-muted-foreground" id={`${id}-value`}>{translateMessage(policy.label)} · {t("{0} 并发", [policy.perOrigin])}</span>
    </div>
    <div className="download-policy-control">
      <div className="relative mx-2" title={translateMessage(policy.description)}>
        <Slider className="h-6" min={0} max={policies.length - 1} step={1} value={[index]} disabled={saving}
          aria-labelledby={`${id}-heading`} aria-describedby={`${id}-value`} aria-valuetext={translateMessage(policy.description)}
          onValueChange={values => setDraft(values[0]!)} onValueCommit={values => void commit(values)} />
        <div className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between" aria-hidden="true">
          {policies.map((key, step) => <span key={key} className={`size-1 rounded-full bg-foreground/25 ${step === index ? 'invisible' : ''}`} />)}
        </div>
      </div>
      <div className="grid min-h-3 grid-cols-5 text-center text-xs leading-3 text-muted-foreground [&>span:first-child]:text-left [&>span:last-child]:text-right" aria-hidden="true">
        {policies.map(key => <span key={key}>{translateMessage(DOWNLOAD_SPEEDS[key].label)}</span>)}
      </div>
    </div>
  </section>;
}
