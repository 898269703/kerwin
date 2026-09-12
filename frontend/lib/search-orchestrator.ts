import { enqueueSearchDiscovery } from './crawler-client';
import { searchLibrary } from './library';
import type { CrawlJob, SearchResponse, SearchResult } from './types';
import { searchWeb } from './web-search';

function isDirectPdf(result: SearchResult): boolean {
  const target = result.finalUrl ?? result.url ?? '';
  try {
    return /\.pdf$/i.test(new URL(target).pathname);
  } catch {
    return false;
  }
}

function candidatePriority(result: SearchResult): number {
  const directPdf = isDirectPdf(result);
  if (directPdf && result.verified) return 0;
  if (result.sourceClass === 'official' || result.sourceClass === 'institutional') return 1;
  if (directPdf) return 2;
  if (result.verified) return 3;
  return 4;
}

export function selectCrawlCandidates(results: SearchResult[], limit = 3): SearchResult[] {
  return results
    .filter((result) => result.origin === 'web' && Boolean(result.finalUrl ?? result.url))
    .slice()
    .sort((a, b) => candidatePriority(a) - candidatePriority(b) || b.score - a.score)
    .slice(0, Math.max(0, limit));
}

export async function runSearch(query: string): Promise<SearchResponse> {
  const warnings: string[] = [];

  let libraryResults: SearchResult[];
  try {
    libraryResults = await searchLibrary(query);
  } catch {
    warnings.push('本站文件库暂时不可用，已保留互联网搜索结果。');
    libraryResults = [];
  }

  if (libraryResults.length > 0) {
    return {
      query,
      results: libraryResults,
      ...(warnings.length ? { warnings } : {}),
      crawl: { state: 'not_needed', jobs: [] },
    };
  }

  let webResults: SearchResult[];
  try {
    webResults = await searchWeb(query);
  } catch {
    warnings.push('互联网搜索暂时不可用，暂时无法启动深度查找。');
    return {
      query,
      results: [],
      warnings,
      crawl: { state: 'unavailable', jobs: [] },
    };
  }

  const candidates = selectCrawlCandidates(webResults, 3);
  if (candidates.length === 0) {
    return {
      query,
      results: webResults,
      ...(warnings.length ? { warnings } : {}),
      crawl: { state: 'unavailable', jobs: [] },
    };
  }

  const settled = await Promise.allSettled(
    candidates.map((candidate) => enqueueSearchDiscovery(candidate.finalUrl ?? candidate.url!, query)),
  );
  const jobs = settled.flatMap((result): CrawlJob[] => result.status === 'fulfilled' ? [result.value] : []);
  const failures = settled.length - jobs.length;

  if (jobs.length === 0) {
    warnings.push('深度查找暂时不可用，已保留当前互联网搜索结果。');
    return {
      query,
      results: webResults,
      warnings,
      crawl: { state: 'unavailable', jobs: [] },
    };
  }

  if (failures > 0) warnings.push('部分深度查找任务未能启动。');

  return {
    query,
    results: webResults,
    ...(warnings.length ? { warnings } : {}),
    crawl: { state: 'started', jobs },
  };
}
