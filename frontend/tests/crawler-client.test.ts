import { afterEach, expect, test, vi } from 'vitest';
import { enqueueSearchDiscovery, getCrawlJob } from '../lib/crawler-client';

const fakeJob = {
  id: 'd9bf6908-c13b-4c19-8b21-fd2db1930a16',
  startUrl: 'https://example.gov/a',
  status: 'queued',
  pagesFetched: 0,
  filesDiscovered: 0,
  filesDownloaded: 0,
  duplicatesFound: 0,
  errorsCount: 0,
  reused: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, Symbol.for('@vercel/request-context'));
  delete process.env.CRAWLER_BASE_URL;
  delete process.env.CRAWLER_API_TOKEN;
  delete process.env.VERCEL_OIDC_TOKEN;
});

test('authenticates job creation and polling with the current function OIDC token', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'stale-build-token';
  Reflect.set(globalThis, Symbol.for('@vercel/request-context'), {
    get: () => ({ headers: { 'x-vercel-oidc-token': 'current-function-token' } }),
  });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(JSON.stringify({ job: fakeJob }), {
    status: init.headers.authorization === 'Bearer current-function-token' ? 200 : 401,
  })));
  expect((await enqueueSearchDiscovery('https://example.gov/a', '156号')).id).toBe(fakeJob.id);
  expect((await getCrawlJob(fakeJob.id)).id).toBe(fakeJob.id);
});

test('adds bearer token only to the server-side search-discovery request', async () => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  process.env.VERCEL_OIDC_TOKEN = 'oidc-fallback';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: fakeJob }), { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);

  const job = await enqueueSearchDiscovery('https://example.gov/a', '156号');

  expect(job.id).toBe(fakeJob.id);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler.example/v1/search-discovery/jobs',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer server-secret' }),
      body: JSON.stringify({ url: 'https://example.gov/a', query: '156号', mode: 'auto' }),
    }),
  );
});

test('falls back to Vercel OIDC and the public worker base in preview', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: fakeJob }), { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);

  await enqueueSearchDiscovery('https://example.gov/a', '156号');

  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler-worker-production.up.railway.app/v1/search-discovery/jobs',
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer vercel-oidc' }),
    }),
  );
});

test('polls a crawl job through the protected worker API', async () => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    job: { ...fakeJob, status: 'running', pagesFetched: 8 },
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const job = await getCrawlJob(fakeJob.id);

  expect(job.status).toBe('running');
  expect(job.pagesFetched).toBe(8);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://crawler.example/v1/crawl/jobs/${fakeJob.id}`,
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer server-secret' }),
      cache: 'no-store',
    }),
  );
});
