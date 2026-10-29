import { useEffect, useId, useRef, useState } from 'react';
import { t, translateMessage } from '../lib/i18n';
import { normalizeCollectOptions } from '../lib/collectOptions';
import type { CollectOptions } from '../lib/types';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel } from './ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';

export function ExtractionOptions({ preview, initialOptions }: { preview: boolean; initialOptions?: CollectOptions }) {
  const id = useId();
  const [options, setOptions] = useState(() => normalizeCollectOptions(initialOptions));
  const [ready, setReady] = useState(preview || initialOptions !== undefined);
  const pending = useRef(false);
  const revision = useRef(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (preview) return;
    let mounted = true;
    const readRevision = revision.current;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (!mounted || area !== 'local' || !changes.collectOptions) return;
      revision.current++;
      setOptions(normalizeCollectOptions(changes.collectOptions.newValue)); setReady(true);
    }
    chrome.storage.onChanged.addListener(changed);
    chrome.storage.local.get('collectOptions').then(value => {
      if (mounted && revision.current === readRevision) { setOptions(normalizeCollectOptions(value.collectOptions)); setReady(true); }
    }).catch(() => { if (mounted) setMessage(t('无法读取选项。')); });
    return () => { mounted = false; chrome.storage.onChanged.removeListener(changed); };
  }, [preview]);

  async function change(key: keyof CollectOptions, checked: boolean) {
    if (!ready || pending.current) return;
    pending.current = true; setMessage('');
    const writeRevision = ++revision.current;
    const next = { ...options, [key]: checked };
    try {
      if (!preview) await chrome.storage.local.set({ collectOptions: next });
      if (revision.current === writeRevision) setOptions(next);
    } catch { setMessage(t('无法保存选项，请重试。')); }
    finally { pending.current = false; }
  }

  const entries = [{ value: 'icons', label: t('网站图标') }, { value: 'css', label: t('背景图像') }, { value: 'inline', label: t('内嵌图像与 SVG') }] as const;
  const selected = entries.filter(item => options[item.value]).map(item => item.value);
  const summary = selected.length === 3 ? t('全部启用') : selected.length === 0 ? t('仅页面图像') : t('已选 {0} 项', [selected.length]);

  return <section className="sidebar-group" aria-labelledby={`${id}-title`}>
    <h3><Label id={`${id}-title`} htmlFor={`${id}-trigger`}>{t('采集范围')}</Label></h3>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={`${id}-trigger`} size="sm" variant="outline" className="collection-options-trigger w-full justify-between" disabled={!ready} aria-labelledby={`${id}-title ${id}-summary`}>
          <span id={`${id}-summary`}>{summary}</span><ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="collection-options w-[var(--radix-dropdown-menu-trigger-width)]" align="start" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}>
        {entries.map(item => <DropdownMenuCheckboxItem key={item.value} checked={options[item.value]}
          onCheckedChange={checked => void change(item.value, checked === true)} onSelect={event => event.preventDefault()}>
          {item.label}
        </DropdownMenuCheckboxItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel id={`${id}-hint`} className="font-normal text-muted-foreground">{t('页面图像始终包含；修改后重新提取生效。')}</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
    {message && <p role="status" className="error text-xs">{translateMessage(message)}</p>}
  </section>;
}
