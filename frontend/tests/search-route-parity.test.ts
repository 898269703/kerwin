import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../lib/library', () => ({ searchLibrary: vi.fn() }));
vi.mock('../lib/web-search', () => ({ searchWeb: vi.fn() }));

import { POST } from '../app/api/search/route';
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

beforeEach(() => {
  vi.mocked(searchLibrary).mockReset();
  vi.mocked(searchWeb).mockReset();
});

test('keeps library results when web discovery fails', async () => {
  vi.mocked(searchLibrary).mockResolvedValue([libraryResult]);
  vi.mocked(searchWeb).mockRejectedValue(new Error('search unavailable'));

  const response = await POST(new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '国家电网财〔2014〕156号' }),
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.results[0].origin).toBe('library');
  expect(body.results[0].libraryId).toBe(libraryResult.libraryId);
  expect(body.warnings).toContain('互联网搜索暂时不可用，已保留本站文件库结果。');
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
