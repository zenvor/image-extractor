import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { t, translateMessage } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, X } from 'lucide-react';
import { Button } from './ui/button';
import { ImageThumbnail, imageFilename } from './ImageThumbnail';
import type { ImageResult } from '../lib/types';

export function ImagePreview({ item, onClose, darkPreview = false }: { item?: ImageResult; onClose(): void; darkPreview?: boolean }) {
  const opener = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setCopied(false); setMessage('');
  }, [item]);
  async function copy() {
    if (!item) return;
    try { await navigator.clipboard.writeText(item.url); setCopied(true); setMessage(t("已复制图像链接")); }
    catch { setMessage(t("无法复制，请选中下方地址后手动复制。")); }
  }
  return <Dialog open={!!item} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="preview-dialog" showCloseButton={false} aria-labelledby="preview-title" aria-describedby="preview-description" data-dark-preview={darkPreview}
      onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
    {item && <>
      <header className="preview-heading"><div><DialogTitle id="preview-title">{imageFilename(item)}</DialogTitle><DialogDescription id="preview-description">{t("页面缩略图预览 ·")}{item.candidate ? t("已转换为原图链接") : t("页面源图")}</DialogDescription></div><DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label={t("关闭预览")}><X /></Button></DialogClose></header>
      <ImageThumbnail item={item} full />
      <Label className="preview-url-label" htmlFor="preview-url">{item.candidate ? t("原图地址") : t("图像地址")}</Label>
      <Input id="preview-url" className="preview-url" readOnly value={item.url} onFocus={event => event.currentTarget.select()} />
      <footer className="preview-actions"><p role="status">{translateMessage(message)}</p><Button variant="outline" size="sm" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? t("已复制") : t("复制链接")}</Button><Button size="sm" asChild><a href={item.url} target="_blank" rel="noreferrer">{item.candidate ? t("打开原图") : t("打开图像")}<ArrowUpRight /></a></Button></footer>
    </>}
    </DialogContent>
  </Dialog>;
}
