import { afterEach, expect, test, vi } from 'vitest';
import { searchLibrary } from '../lib/library';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRAWLER_PUBLIC_BASE_URL;
  delete process.env.CRAWLER_BASE_URL;
});

test('maps public library results into verified local download results', async () => {
  process.env.CRAWLER_PUBLIC_BASE_URL = 'https://crawler.example';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: '156号',
    results: [{
      origin: 'library',
      id: '51957b6f-1111-2222-3333-444444444444',
      title: '国家电网财〔2014〕156号',
      filename: '156.pdf',
      documentNumber: '国家电网财〔2014〕156号',
      byteSize: 1234,
      sourceCount: 2,
      score: 0.93,
      downloadPath: '/public/file?id=51957b6f-1111-2222-3333-444444444444'
    }]
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const rows = await searchLibrary('156号');

  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler.example/public/search?q=156%E5%8F%B7&limit=20',
    expect.objectContaining({ cache: 'no-store' }),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    origin: 'library',
    sourceClass: 'library',
    verified: true,
    libraryId: '51957b6f-1111-2222-3333-444444444444',
    title: '国家电网财〔2014〕156号',
    source: '本站文件库',
  });
  expect(rows[0].score).toBe(93);
  expect(rows[0].reasons).toContain('本站已收录');
});

test('uses the production public worker base when no override is configured', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: '预算定额', results: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(searchLibrary('预算定额')).resolves.toEqual([]);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler-worker-production.up.railway.app/public/search?q=%E9%A2%84%E7%AE%97%E5%AE%9A%E9%A2%9D&limit=20',
    expect.objectContaining({ cache: 'no-store' }),
  );
});
