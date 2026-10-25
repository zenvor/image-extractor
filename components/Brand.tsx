import { LanguageControl } from './LanguageControl';
import { t } from '../lib/i18n';
import { version } from '../package.json';

export function Brand({ subtitle = t("图像采集与原图下载"), compact = false }: { subtitle?: string; compact?: boolean }) {
  return <div className="brand">
    <img className="brand-mark" src="/icons/mark.png" width="32" height="32" alt="" />
    <div className="brand-text"><h1>Image Extractor</h1><p className={compact ? 'brand-version' : undefined}>{compact ? t("版本 {0}", [version]) : subtitle}</p></div>
    {!compact && <><span className="version">v{version}</span><LanguageControl compact /></>}
  </div>;
}
