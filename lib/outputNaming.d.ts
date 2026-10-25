export function imageExtension(value?: string, mime?: string): string;
export const MAX_ARCHIVE_IMAGES: number;
export function numberedImageName(sequence: number, extension?: string, basename?: string): string;
export function pageFolderName(title: string, fallback?: string): string;
export function archiveFilename(title: string, fallback?: string): string;
export function allocateImageNames(items: { kind?: 'large' | 'small'; format?: string; url?: string; basename?: string }[]): string[];
