import type { SearchResult } from './types';

function normalizedUrl(result: SearchResult): string {
  const value = result.finalUrl || result.url || '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function mergeAndRankInitialResults(
  library: SearchResult[],
  web: SearchResult[],
): SearchResult[] {
  const seen = new Set<string>();
  const rows: SearchResult[] = [];

  for (const result of [...library, ...web]) {
    const key = result.libraryId ? `library:${result.libraryId}` : `url:${normalizedUrl(result)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(result);
  }

  return rows.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'library' ? -1 : 1;
    return b.score - a.score;
  });
}
