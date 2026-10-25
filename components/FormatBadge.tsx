import { Badge } from './ui/badge';
import type { ImageFormat } from '../lib/urlImageFormat';

export function FormatBadge({ format }: { format: ImageFormat }) {
  return <Badge className="format-badge" data-format={format}>{format}</Badge>;
}
