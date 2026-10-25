import { Label } from './ui/label';
import { useId, useState } from 'react';
import { t, setLanguagePreference, type LanguagePreference } from '../lib/i18n';
import { useLocale } from '../lib/useLocale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function LanguageControl({ compact = false }: { compact?: boolean }) {
  const { preference } = useLocale();
  const id = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState(false);
  return <div ref={setContainer} className={compact ? 'language-control language-control-compact' : 'language-control'}>
    {!compact && <Label htmlFor={id}>{t('界面语言')}</Label>}
    <Select value={preference} onValueChange={value => { setError(false); void setLanguagePreference(value as LanguagePreference).catch(() => setError(true)); }}>
      <SelectTrigger id={id} aria-label={t('界面语言')}><SelectValue /></SelectTrigger>
      <SelectContent container={container}><SelectItem value="auto">{t('跟随浏览器')}</SelectItem><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
    </Select>
    {!compact && <p className="text-xs text-muted-foreground">{t('切换后立即生效，适用于所有扩展页面。')}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{t('语言设置保存失败，请重试。')}</p>}
  </div>;
}
