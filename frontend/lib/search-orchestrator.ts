import { searchLibrary } from './library';
import type { SearchResponse } from './types';
import { searchWeb } from './web-search';

export async function runSearch(query: string): Promise<SearchResponse> {
  const warnings: string[] = [];
  const [libraryOutcome, webOutcome] = await Promise.allSettled([
    searchLibrary(query),
    searchWeb(query),
  ]);

  const libraryResults = libraryOutcome.status === 'fulfilled' ? libraryOutcome.value : [];
  if (libraryOutcome.status === 'rejected') {
    warnings.push('本站文件库暂时不可用，已保留互联网搜索结果。');
  }
  if (webOutcome.status === 'rejected') {
    warnings.push('互联网搜索暂时不可用，已保留本站文件库结果。');
    return {
      query,
      results: libraryResults,
      warnings,
      crawl: { state: 'unavailable', jobs: [] },
    };
  }

  const webResults = webOutcome.value;
  return {
    query,
    results: [...libraryResults, ...webResults],
    ...(warnings.length ? { warnings } : {}),
    crawl: { state: webResults.length > 0 ? 'not_started' : 'not_needed', jobs: [] },
  };
}
