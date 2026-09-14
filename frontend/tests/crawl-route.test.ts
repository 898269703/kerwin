import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../lib/crawler-client', () => ({ enqueueSearchDiscovery: vi.fn() }));
vi.mock('../lib/web-search', () => ({ searchWeb: vi.fn() }));

import { POST } from '../app/api/crawl/route';
import { enqueueSearchDiscovery } from '../lib/crawler-client';
import { searchWeb } from '../lib/web-search';

const job = {
  id: '00000000-0000-0000-0000-000000000001',
  startUrl: 'https://example.gov/a.pdf',
  status: 'queued' as const,
  pagesFetched: 0,
  filesDiscovered: 0,
  filesDownloaded: 0,
  duplicatesFound: 0,
  errorsCount: 0,
};

function request(body: unknown) {
  return new Request('http://localhost/api/crawl', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(enqueueSearchDiscovery).mockReset();
  vi.mocked(searchWeb).mockReset();
  vi.mocked(searchWeb).mockResolvedValue([
    {
      origin: 'web', sourceClass: 'official', verified: true, score: 95,
      title: 'A', source: 'example.gov', snippet: 'A', reasons: ['官方来源'], contentLength: 1,
      url: 'https://example.gov/a.pdf', finalUrl: 'https://example.gov/a.pdf',
    },
    {
      origin: 'web', sourceClass: 'public', verified: false, score: 50,
      title: 'B', source: 'docs.example.org', snippet: 'B', reasons: ['公开互联网来源'], contentLength: 1,
      url: 'https://docs.example.org/b', finalUrl: 'https://docs.example.org/b',
    },
  ]);
});

test('rejects malformed query and URL selections before contacting the worker', async () => {
  const cases = [
    { query: '', urls: ['https://example.gov/a.pdf'] },
    { query: '预算定额', urls: [] },
    { query: '预算定额', urls: ['https://example.gov/a.pdf', 'https://example.gov/a.pdf'] },
    { query: '预算定额', urls: ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test'] },
    { query: '预算定额', urls: ['file:///tmp/a.pdf'] },
    { query: '预算定额', urls: ['http://127.0.0.1/a.pdf'] },
    { query: '预算定额', urls: ['http://localhost/a.pdf'] },
  ];

  for (const body of cases) {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
  }
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
  expect(searchWeb).not.toHaveBeenCalled();
});

test('rejects a public URL that is not a candidate for the current query', async () => {
  const response = await POST(request({ query: '预算定额', urls: ['https://unrelated.example/file.pdf'] }));

  expect(response.status).toBe(400);
  expect(await response.text()).toContain('不属于当前互联网搜索结果');
  expect(enqueueSearchDiscovery).not.toHaveBeenCalled();
});

test('enqueues only the user-selected public URLs', async () => {
  vi.mocked(enqueueSearchDiscovery)
    .mockResolvedValueOnce(job)
    .mockResolvedValueOnce({ ...job, id: '00000000-0000-0000-0000-000000000002', startUrl: 'https://docs.example.org/b' });

  const response = await POST(request({
    query: '预算定额',
    urls: ['https://example.gov/a.pdf', 'https://docs.example.org/b'],
  }));
  const body = await response.json();

  expect(response.status).toBe(202);
  expect(body.state).toBe('started');
  expect(body.jobs).toHaveLength(2);
  expect(enqueueSearchDiscovery).toHaveBeenNthCalledWith(1, 'https://example.gov/a.pdf', '预算定额');
  expect(enqueueSearchDiscovery).toHaveBeenNthCalledWith(2, 'https://docs.example.org/b', '预算定额');
});

test('keeps successful jobs when one selected source cannot start', async () => {
  vi.mocked(enqueueSearchDiscovery)
    .mockResolvedValueOnce(job)
    .mockRejectedValueOnce(new Error('secret upstream detail'));

  const response = await POST(request({
    query: '预算定额',
    urls: ['https://example.gov/a.pdf', 'https://docs.example.org/b'],
  }));
  const text = await response.text();
  const body = JSON.parse(text);

  expect(response.status).toBe(202);
  expect(body.jobs).toEqual([job]);
  expect(body.warnings).toEqual(['部分选中来源未能启动抓取。']);
  expect(text).not.toContain('secret upstream detail');
});

test('returns a controlled error when no selected source can start', async () => {
  vi.mocked(enqueueSearchDiscovery).mockImplementation(() => {
    throw new Error('secret upstream detail');
  });

  const response = await POST(request({ query: '预算定额', urls: ['https://example.gov/a.pdf'] }));
  const text = await response.text();

  expect(response.status).toBe(503);
  expect(text).toContain('选中来源暂时无法开始抓取');
  expect(text).not.toContain('secret upstream detail');
});
