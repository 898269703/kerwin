import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../lib/crawler-client', () => ({ getCrawlJob: vi.fn(), enqueueSearchDiscovery: vi.fn() }));
vi.mock('../lib/library', () => ({ searchLibrary: vi.fn() }));

import { GET } from '../app/api/search/status/route';
import { getCrawlJob } from '../lib/crawler-client';
import { searchLibrary } from '../lib/library';

const runningJob = {
  id: '00000000-0000-0000-0000-000000000001',
  startUrl: 'https://example.gov/a',
  status: 'running' as const,
  pagesFetched: 8,
  filesDiscovered: 2,
  filesDownloaded: 0,
  duplicatesFound: 0,
  errorsCount: 0,
};

const doneJob = {
  ...runningJob,
  status: 'succeeded' as const,
  pagesFetched: 12,
  filesDownloaded: 1,
};

const libraryResult = {
  origin: 'library' as const,
  sourceClass: 'library' as const,
  verified: true,
  score: 99,
  title: '预算定额',
  source: '本站文件库',
  snippet: 'budget.pdf',
  reasons: ['本站已收录'],
  contentLength: 1024,
  libraryId: '51957b6f-1111-2222-3333-444444444444',
};

beforeEach(() => {
  vi.mocked(getCrawlJob).mockReset();
  vi.mocked(searchLibrary).mockReset();
});

test('rejects missing, invalid, or too many crawl job ids', async () => {
  const missing = await GET(new Request('http://localhost/api/search/status?q=预算定额'));
  const invalid = await GET(new Request('http://localhost/api/search/status?q=预算定额&jobId=bad'));
  const tooMany = await GET(new Request(
    'http://localhost/api/search/status?q=预算定额' +
      '&jobId=00000000-0000-0000-0000-000000000001' +
      '&jobId=00000000-0000-0000-0000-000000000002' +
      '&jobId=00000000-0000-0000-0000-000000000003' +
      '&jobId=00000000-0000-0000-0000-000000000004',
  ));

  expect(missing.status).toBe(400);
  expect(invalid.status).toBe(400);
  expect(tooMany.status).toBe(400);
  expect(getCrawlJob).not.toHaveBeenCalled();
});

test('returns running progress without refreshing the library', async () => {
  vi.mocked(getCrawlJob).mockResolvedValue(runningJob);

  const response = await GET(new Request(
    `http://localhost/api/search/status?q=${encodeURIComponent('预算定额')}&jobId=${runningJob.id}`,
  ));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.state).toBe('running');
  expect(body.jobs).toEqual([runningJob]);
  expect(body.libraryResults).toEqual([]);
  expect(searchLibrary).not.toHaveBeenCalled();
});

test('refreshes the library once every job is terminal', async () => {
  vi.mocked(getCrawlJob).mockResolvedValue(doneJob);
  vi.mocked(searchLibrary).mockResolvedValue([libraryResult]);

  const response = await GET(new Request(
    `http://localhost/api/search/status?q=${encodeURIComponent('预算定额')}&jobId=${doneJob.id}`,
  ));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.state).toBe('complete');
  expect(body.jobs).toEqual([doneJob]);
  expect(body.libraryResults).toEqual([libraryResult]);
  expect(searchLibrary).toHaveBeenCalledWith('预算定额');
});

test('one worker status failure preserves successful jobs and never exposes secrets', async () => {
  process.env.CRAWLER_API_TOKEN = 'super-secret-token';
  vi.mocked(getCrawlJob)
    .mockResolvedValueOnce(runningJob)
    .mockRejectedValueOnce(new Error('crawler request failed with 503'));

  const secondId = '00000000-0000-0000-0000-000000000002';
  const response = await GET(new Request(
    `http://localhost/api/search/status?q=${encodeURIComponent('预算定额')}&jobId=${runningJob.id}&jobId=${secondId}`,
  ));
  const text = await response.text();
  const body = JSON.parse(text);

  expect(response.status).toBe(200);
  expect(body.state).toBe('running');
  expect(body.jobs).toEqual([runningJob]);
  expect(body.warnings).toContain('部分深度查找状态暂时不可用。');
  expect(text).not.toContain('super-secret-token');
  expect(searchLibrary).not.toHaveBeenCalled();

  delete process.env.CRAWLER_API_TOKEN;
});
