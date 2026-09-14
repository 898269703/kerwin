import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../lib/library', () => ({ searchLibrary: vi.fn() }));
vi.mock('../lib/web-search', () => ({ searchWeb: vi.fn() }));
vi.mock('../lib/crawler-client', () => ({ enqueueSearchDiscovery: vi.fn(), getCrawlJob: vi.fn() }));

import { POST } from '../app/api/search/route';
import { enqueueSearchDiscovery } from '../lib/crawler-client';
import { searchLibrary } from '../lib/library';
import { searchWeb } from '../lib/web-search';

const libraryResult = {
  origin: 'library' as const,
  sourceClass: 'library' as const,
  verified: true,
  score: 98,
  title: '国家电网财〔2014〕156号',
  source: '本站文件库',
  snippet: '156.pdf',
  reasons: ['本站已收录'],
  contentLength: 1234,
  libraryId: '51957b6f-1111-2222-3333-444444444444',
};

const webResult = {
  origin: 'web' as const,
  sourceClass: 'official' as const,
  verified: true,
  score: 95,
  title: '预算定额 PDF',
  source: 'example.gov',
  snippet: '公开来源',
  reasons: ['官方来源', 'PDF 直链'],
  contentLength: 4,
  url: 'https://example.gov/budget.pdf',
  finalUrl: 'https://example.gov/budget.pdf',
};

beforeEach(() => {
  vi.mocked(searchLibrary).mockReset();
  vi.mocked(searchWeb).mockReset();
  vi.mocked(enqueueSearchDiscovery).mockReset();
});

test('library hit is returned first while web candidates remain selectable', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([libraryResult]);
  vi.mocked(searchWeb).mockResolvedValue([webResult]);

  const response = await POST(new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '国家电网财〔2014〕156号' }),
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.results).toEqual([libraryResult, webResult]);
  expect(body.results[0].libraryId).toBe(libraryResult.libraryId);
  expect(body.crawl.state).toBe('not_started');
  expect(searchWeb).toHaveBeenCalledWith('国家电网财〔2014〕156号');
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('zero library hit returns web candidates and waits for explicit selection', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([]);
  vi.mocked(searchWeb).mockResolvedValue([webResult]);

  const response = await POST(new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '预算定额' }),
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.results).toEqual([webResult]);
  expect(body.crawl).toEqual({ state: 'not_started', jobs: [] });
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('rejects missing or oversized query', async () => {
  const missing = await POST(new Request('http://localhost/api/search', {
    method: 'POST',
    body: JSON.stringify({ query: '   ' }),
  }));
  const oversized = await POST(new Request('http://localhost/api/search', {
    method: 'POST',
    body: JSON.stringify({ query: 'x'.repeat(201) }),
  }));

  expect(missing.status).toBe(400);
  expect(oversized.status).toBe(400);
  expect(searchLibrary).not.toHaveBeenCalled();
});
