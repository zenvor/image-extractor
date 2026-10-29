import { Label } from './ui/label';
import { useId, useState } from 'react';
import { t, setLanguagePreference } from '../lib/i18n';
import { useLocale } from '../lib/useLocale';
import { Button } from './ui/button';
import { Languages } from 'lucide-react';

export function LanguageControl({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const id = useId();
  const [error, setError] = useState(false);
  const nextLocale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const currentLanguage = locale === 'zh-CN' ? '中文' : 'English';
  const nextLanguage = nextLocale === 'en' ? 'English' : '中文';
  return <div className={compact ? 'language-control language-control-compact' : 'language-control'}>
    {!compact && <Label htmlFor={id}>{t('界面语言')}</Label>}
    <Button variant="ghost" className="w-full cursor-pointer font-normal text-muted-foreground" id={id} lang={locale}
      aria-label={`${t('界面语言')}: ${currentLanguage}`} title={t('切换语言为 {0}', [nextLanguage])}
      onClick={() => { setError(false); void setLanguagePreference(nextLocale).catch(() => setError(true)); }}>
      <Languages className="size-4" aria-hidden="true" />{currentLanguage}
    </Button>
    {!compact && <p className="text-xs text-muted-foreground">{t('切换后立即生效，适用于所有扩展页面。')}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{t('语言设置保存失败，请重试。')}</p>}
  </div>;
}
