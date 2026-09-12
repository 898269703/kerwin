import type { SearchResult } from './types';

type LibraryRow = {
  id?: string;
  title?: string;
  filename?: string | null;
  documentNumber?: string | null;
  byteSize?: number;
  sourceCount?: number;
  score?: number;
};

type LibraryPayload = {
  query?: string;
  results?: LibraryRow[];
};

const DEFAULT_CRAWLER_PUBLIC_BASE_URL = 'https://crawler-worker-production.up.railway.app';

function crawlerPublicBase(): string {
  const raw = process.env.CRAWLER_PUBLIC_BASE_URL ?? process.env.CRAWLER_BASE_URL ?? DEFAULT_CRAWLER_PUBLIC_BASE_URL;
  return raw.trim().replace(/\/$/, '');
}

export async function searchLibrary(query: string): Promise<SearchResult[]> {
  const base = crawlerPublicBase();

  const response = await fetch(
    `${base}/public/search?q=${encodeURIComponent(query)}&limit=20`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    throw new Error(`library search failed with ${response.status}`);
  }

  const payload = (await response.json()) as LibraryPayload;
  return (payload.results ?? []).flatMap((row): SearchResult[] => {
    if (!row.id || !row.title) return [];
    const sourceCount = Math.max(0, Number(row.sourceCount ?? 0));
    const backendScore = Number(row.score ?? 0);
    const score = backendScore <= 1 ? backendScore * 100 : backendScore;
    const reasons = ['本站已收录'];
    if (row.documentNumber) reasons.push('已识别文号');
    if (sourceCount > 1) reasons.push(`${sourceCount} 个来源已去重`);

    return [{
      origin: 'library',
      sourceClass: 'library',
      verified: true,
      score: Math.max(0, Math.min(100, score)),
      title: row.title,
      source: '本站文件库',
      snippet: row.documentNumber || row.filename || '已验证 PDF 文件',
      reasons,
      contentLength: Math.max(0, Number(row.byteSize ?? 0)),
      libraryId: row.id,
    }];
  });
}
