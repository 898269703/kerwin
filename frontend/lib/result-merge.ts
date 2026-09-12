import type { SearchResult } from './types';

function canonicalUrl(result: SearchResult): string {
  const raw = result.finalUrl ?? result.url ?? '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|source$|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizedTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sameDocument(a: SearchResult, b: SearchResult): boolean {
  if (a.libraryId && b.libraryId && a.libraryId === b.libraryId) return true;

  const aUrl = canonicalUrl(a);
  const bUrl = canonicalUrl(b);
  if (aUrl && bUrl && aUrl === bUrl) return true;

  const aTitle = normalizedTitle(a.title);
  const bTitle = normalizedTitle(b.title);
  return aTitle.length >= 4 && aTitle === bTitle;
}

export function mergePostCrawlResults(
  library: SearchResult[],
  existing: SearchResult[],
): SearchResult[] {
  const promoted: SearchResult[] = [];

  for (const result of [...library].sort((a, b) => b.score - a.score)) {
    if (!promoted.some((item) => sameDocument(item, result))) promoted.push(result);
  }

  for (const result of existing) {
    if (promoted.some((item) => sameDocument(item, result))) continue;
    promoted.push(result);
  }

  return promoted;
}
