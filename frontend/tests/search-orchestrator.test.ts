import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../lib/library', () => ({ searchLibrary: vi.fn() }));
vi.mock('../lib/web-search', () => ({ searchWeb: vi.fn() }));
vi.mock('../lib/crawler-client', () => ({ enqueueSearchDiscovery: vi.fn(), getCrawlJob: vi.fn() }));

import { enqueueSearchDiscovery } from '../lib/crawler-client';
import { searchLibrary } from '../lib/library';
import { runSearch } from '../lib/search-orchestrator';
import { searchWeb } from '../lib/web-search';

const libraryResult = {
  origin: 'library' as const,
  sourceClass: 'library' as const,
  verified: true,
  score: 99,
  title: '已收录文件',
  source: '本站文件库',
  snippet: 'stored.pdf',
  reasons: ['本站已收录'],
  contentLength: 1024,
  libraryId: '51957b6f-1111-2222-3333-444444444444',
};

function webResult(index: number, overrides: Record<string, unknown> = {}) {
  return {
    origin: 'web' as const,
    sourceClass: 'public' as const,
    verified: false,
    score: 60 - index,
    title: `候选 ${index}`,
    source: `example${index}.com`,
    snippet: '公开网页',
    reasons: ['公开互联网来源'],
    contentLength: 4,
    url: `https://example${index}.com/page`,
    finalUrl: `https://example${index}.com/page`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(searchLibrary).mockReset();
  vi.mocked(searchWeb).mockReset();
  vi.mocked(enqueueSearchDiscovery).mockReset();
});

test('returns library results first and still searches the web without crawling', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([libraryResult]);
  const candidate = webResult(0);
  vi.mocked(searchWeb).mockResolvedValue([candidate]);

  const response = await runSearch('已收录文件');

  expect(response.results).toEqual([libraryResult, candidate]);
  expect(response.crawl?.state).toBe('not_started');
  expect(searchWeb).toHaveBeenCalledWith('已收录文件');
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('on zero library hits returns every web candidate without enqueueing a crawl', async () => {
  const candidates = [
    webResult(0),
    webResult(1, { sourceClass: 'official', verified: true, score: 95, finalUrl: 'https://gov.example/a.pdf', url: 'https://gov.example/a.pdf' }),
    webResult(2, { sourceClass: 'institutional', verified: true, score: 88 }),
    webResult(3, { score: 85, finalUrl: 'https://example3.com/b.pdf', url: 'https://example3.com/b.pdf' }),
    webResult(4),
  ];
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue(candidates);

  const response = await runSearch('预算定额');

  expect(response.results).toHaveLength(5);
  expect(response.crawl).toEqual({ state: 'not_started', jobs: [] });
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('returns no-results state without contacting the crawler', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue([]);

  const response = await runSearch('暂未收录');

  expect(response.results).toEqual([]);
  expect(response.crawl).toEqual({ state: 'not_needed', jobs: [] });
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});
