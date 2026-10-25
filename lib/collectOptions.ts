import type { CollectOptions } from './types';

// New/unset options are enabled; keep each explicitly saved opt-out.
export function normalizeCollectOptions(value?: unknown): Required<CollectOptions> {
  const saved = value && typeof value === 'object' ? value as CollectOptions : {};
  return { icons: saved.icons !== false, css: saved.css !== false, inline: saved.inline !== false };
}
