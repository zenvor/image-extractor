export const ORIGINAL_RESOLVER_VERSION: string;
export function hostnameMatches(hostname: string, domain: string): boolean;

export type OriginalImageResolution = {
  candidateId: string | null;
  contextRef: string | null;
  version: string;
} & (
  | {
      status: 'resolved';
      url: string;
      resolver: string;
      evidence:
        | { inputPath: string; outputPath: string; matchedHostname: string }
        | { matchedHostname: string; legacy: true; resolvedOriginal: true };
    }
  | {
      status: 'unchanged';
      url: string;
      resolver: string;
      evidence:
        | { reason: string; resolvedOriginal: false }
        | { matchedHostname: string; legacy: true; resolvedOriginal: false };
    }
  | {
      status: 'no_match';
      url: null;
      resolver: null;
      evidence: { reason: string };
    }
);

export function resolveOriginalImage(candidate: string | { url: string; id?: string; contextRef?: string }, options?: { type?: string; fallbackUnchanged?: boolean }): OriginalImageResolution;
