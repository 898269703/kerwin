import { afterEach, expect, test, vi } from 'vitest';
import { GET } from '../app/api/library/file/route';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, Symbol.for('@vercel/request-context'));
  delete process.env.CRAWLER_BASE_URL;
  delete process.env.CRAWLER_API_TOKEN;
  delete process.env.VERCEL_OIDC_TOKEN;
});

test('uses the current function OIDC token instead of a stale build token', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'stale-build-token';
  Reflect.set(globalThis, Symbol.for('@vercel/request-context'), {
    get: () => ({ headers: { 'x-vercel-oidc-token': 'current-function-token' } }),
  });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) =>
    new Response('%PDF-runtime', {
      status: init.headers.authorization === 'Bearer current-function-token' ? 200 : 401,
      headers: { 'content-type': 'application/pdf' },
    })));
  const response = await GET(new Request('http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444'));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('%PDF-runtime');
  expect(response.headers.get('authorization')).toBeNull();
});

test.each(['', '&download=1'])('preserves a Chinese filename in a valid HTTP header (%s)', async (suffix) => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('%PDF-chinese', {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': "attachment; filename=\"document.pdf\"; filename*=UTF-8''%E8%A7%84%E8%8C%83.pdf",
    },
  })));
  const response = await GET(new Request(`http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444${suffix}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''%E8%A7%84%E8%8C%83.pdf");
  expect(response.headers.get('content-disposition')).toMatch(suffix ? /^attachment;/ : /^inline;/);
  expect(await response.text()).toBe('%PDF-chinese');
});

test('returns a sanitized unavailable response when the worker cannot be reached', async () => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private connection details')));
  const response = await GET(new Request('http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444'));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'file service unavailable' });
});

test('fails closed without credentials before requesting PDF bytes', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const response = await GET(new Request('http://localhost/api/library/file?id=51957b6f-1111-2222-3333-444444444444'));
  expect(response.status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
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
