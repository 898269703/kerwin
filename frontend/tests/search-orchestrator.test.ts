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

function job(index: number, url: string) {
  return {
    id: `00000000-0000-0000-0000-00000000000${index}`,
    startUrl: url,
    status: 'queued' as const,
    pagesFetched: 0,
    filesDiscovered: 0,
    filesDownloaded: 0,
    duplicatesFound: 0,
    errorsCount: 0,
    reused: false,
  };
}

beforeEach(() => {
  vi.mocked(searchLibrary).mockReset();
  vi.mocked(searchWeb).mockReset();
  vi.mocked(enqueueSearchDiscovery).mockReset();
});

test('does not web-search or crawl when the library already has a result', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([libraryResult]);

  const response = await runSearch('已收录文件');

  expect(response.results).toEqual([libraryResult]);
  expect(response.crawl?.state).toBe('not_needed');
  expect(searchWeb).not.toHaveBeenCalled();
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('on zero library hits returns web results immediately and enqueues at most three best candidates', async () => {
  const candidates = [
    webResult(0),
    webResult(1, { sourceClass: 'official', verified: true, score: 95, finalUrl: 'https://gov.example/a.pdf', url: 'https://gov.example/a.pdf' }),
    webResult(2, { sourceClass: 'institutional', verified: true, score: 88 }),
    webResult(3, { score: 85, finalUrl: 'https://example3.com/b.pdf', url: 'https://example3.com/b.pdf' }),
    webResult(4),
  ];
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue(candidates);
  vi.mocked(enqueueSearchDiscovery).mockImplementation(async (url) => job(vi.mocked(enqueueSearchDiscovery).mock.calls.length, url));

  const response = await runSearch('预算定额');

  expect(response.results).toHaveLength(5);
  expect(response.crawl?.state).toBe('started');
  expect(response.crawl?.jobs).toHaveLength(3);
  expect(enqueueSearchDiscovery).toHaveBeenCalledTimes(3);
  const calledUrls = vi.mocked(enqueueSearchDiscovery).mock.calls.map(([url]) => url);
  expect(calledUrls).toContain('https://gov.example/a.pdf');
  expect(calledUrls).toContain('https://example2.com/page');
  expect(calledUrls).toContain('https://example3.com/b.pdf');
});

test('keeps web results and reports unavailable when every crawl enqueue fails', async () => {
  const candidates = [webResult(0), webResult(1)];
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue(candidates);
  vi.mocked(enqueueSearchDiscovery).mockRejectedValue(new Error('crawler unavailable'));

  const response = await runSearch('暂未收录');

  expect(response.results).toEqual(candidates);
  expect(response.crawl?.state).toBe('unavailable');
  expect(response.crawl?.jobs).toEqual([]);
  expect(response.warnings).toContain('深度查找暂时不可用，已保留当前互联网搜索结果。');
});

test('a single candidate failure does not cancel other crawl jobs', async () => {
  const candidates = [webResult(0), webResult(1), webResult(2)];
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue(candidates);
  vi.mocked(enqueueSearchDiscovery)
    .mockRejectedValueOnce(new Error('one failed'))
    .mockImplementation(async (url) => job(2, url));

  const response = await runSearch('预算文件');

  expect(response.crawl?.state).toBe('started');
  expect(response.crawl?.jobs).toHaveLength(2);
  expect(response.warnings).toContain('部分深度查找任务未能启动。');
});
