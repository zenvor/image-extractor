import { useEffect, useId, useRef, useState } from 'react';
import { t, translateMessage } from '../lib/i18n';
import { normalizeCollectOptions } from '../lib/collectOptions';
import type { CollectOptions } from '../lib/types';
import { Combobox, ComboboxTrigger, ComboboxValue, ComboboxContent, ComboboxChipsInput, ComboboxList, ComboboxItem } from './ui/combobox';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Separator } from './ui/separator';

export function ExtractionOptions({ preview }: { preview: boolean }) {
  const id = useId();
  const [options, setOptions] = useState(normalizeCollectOptions);
  const [ready, setReady] = useState(preview);
  const [saving, setSaving] = useState(false);
  const [showNavigationHighlight, setShowNavigationHighlight] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (preview) return;
    let mounted = true;
    chrome.storage.local.get('collectOptions').then(value => {
      if (mounted) { setOptions(normalizeCollectOptions(value.collectOptions)); setReady(true); }
    }).catch(() => { if (mounted) setMessage(t('无法读取选项。')); });
    return () => { mounted = false; };
  }, [preview]);

  async function change(selected: (keyof CollectOptions)[]) {
    if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setMessage('');
    const next = { icons: selected.includes('icons'), css: selected.includes('css'), inline: selected.includes('inline') };
    try {
      if (!preview) await chrome.storage.local.set({ collectOptions: next });
      setOptions(next);
    } catch { setMessage(t('无法保存选项，请重试。')); }
    finally { pending.current = false; setSaving(false); }
  }

  const entries = [{ value: 'icons', label: t('网站图标') }, { value: 'css', label: t('背景图像') }, { value: 'inline', label: t('内嵌图像与 SVG') }] as const;
  const selected = entries.filter(item => options[item.value]).map(item => item.value);
  const summary = selected.length === 3 ? t('全部启用') : selected.length === 0 ? t('仅页面图像') : t('已选 {0} 项', [selected.length]);

  return <section className="sidebar-group" aria-labelledby={`${id}-title`}>
    <h3><Label id={`${id}-title`} htmlFor={`${id}-trigger`}>{t('其他图像来源')}</Label></h3>
    <Combobox multiple value={selected} onValueChange={value => void change(value)} disabled={!ready}
      onOpenChange={(open, details) => setShowNavigationHighlight(open && details.event.type === 'keydown')}
      onItemHighlighted={(_, details) => {
        if (details.reason === 'keyboard' || details.reason === 'pointer') setShowNavigationHighlight(true);
      }}>
      <ComboboxTrigger id={`${id}-trigger`} className="collection-options-trigger w-full justify-between font-normal" render={<Button variant="outline" size="sm" />} aria-labelledby={`${id}-title ${id}-summary`}>
        <span id={`${id}-summary`}><ComboboxValue>{summary}</ComboboxValue></span>
      </ComboboxTrigger>
      <ComboboxContent aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}>
        {/* Read-only navigation input keeps the compact picker keyboard-accessible. */}
        <ComboboxChipsInput className="sr-only min-w-0" readOnly aria-label={t('其他图像来源')} />
        <ComboboxList className="collection-options" onPointerMove={() => setShowNavigationHighlight(true)}>
          {entries.map(item => <ComboboxItem key={item.value} value={item.value} disabled={saving}
            className={showNavigationHighlight ? undefined : 'data-highlighted:bg-transparent data-highlighted:text-foreground'}>{item.label}</ComboboxItem>)}
        </ComboboxList>
        <Separator />
        <p className="px-3 py-2 text-xs text-muted-foreground" id={`${id}-hint`}>{t('页面图像始终提取；其他来源重新提取后生效。')}</p>
      </ComboboxContent>
    </Combobox>
    {message && <p role="status" className="error text-xs">{translateMessage(message)}</p>}
  </section>;
}
