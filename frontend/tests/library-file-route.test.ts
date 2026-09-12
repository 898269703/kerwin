import { afterEach, expect, test, vi } from 'vitest';
import { GET } from '../app/api/library/file/route';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRAWLER_BASE_URL;
  delete process.env.CRAWLER_API_TOKEN;
  delete process.env.VERCEL_OIDC_TOKEN;
});

test('proxies a stored PDF with bearer token only on the server request', async () => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  process.env.VERCEL_OIDC_TOKEN = 'oidc-fallback';
  const fetchMock = vi.fn().mockResolvedValue(new Response('%PDF-test', {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="156.pdf"' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  const response = await GET(new Request(
    'http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444&download=1',
  ));

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/pdf');
  expect(response.headers.get('content-disposition')).toContain('attachment');
  expect(response.headers.get('authorization')).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler.example/v1/documents/51957b6f-1111-2222-3333-444444444444/file',
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer server-secret' }),
      cache: 'no-store',
    }),
  );
});

test('uses Vercel OIDC and the production worker by default in preview', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc';
  const fetchMock = vi.fn().mockResolvedValue(new Response('%PDF-preview', {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="preview.pdf"' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  const response = await GET(new Request(
    'http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444',
  ));

  expect(response.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler-worker-production.up.railway.app/v1/documents/51957b6f-1111-2222-3333-444444444444/file',
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer vercel-oidc' }),
      cache: 'no-store',
    }),
  );
});

test('rejects invalid document ids before calling the worker', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const response = await GET(new Request('http://localhost/api/library/file?id=../../etc/passwd'));
  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
