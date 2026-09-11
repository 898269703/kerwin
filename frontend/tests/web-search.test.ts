import { afterEach, expect, test, vi } from 'vitest';
import { rankWebCandidates, searchWeb } from '../lib/web-search';

const officialPdf = {
  title: '电力建设工程预算定额 PDF',
  url: 'https://www.sgcc.com.cn/files/yusuan.pdf',
  content: '电力建设工程预算定额 正式文件',
};

const genericPage = {
  title: '预算定额资料分享',
  url: 'https://example.com/post/123',
  content: '预算定额资料整理与介绍',
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARXNG_BASE_URL;
});

test('official direct PDF ranks above a generic page with similar query text', () => {
  const results = rankWebCandidates('预算定额', [genericPage, officialPdf]);
  expect(results).toHaveLength(2);
  expect(results[0].sourceClass).toBe('official');
  expect(results[0].finalUrl).toContain('.pdf');
  expect(results[0].score).toBeGreaterThan(results[1].score);
  expect(results[0].verified).toBe(true);
});

test('normalizes SearXNG JSON into UI results', async () => {
  process.env.SEARXNG_BASE_URL = 'https://search.example';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    results: [officialPdf, genericPage]
  }), { status: 200 })));

  const results = await searchWeb('预算定额');

  expect(results[0].origin).toBe('web');
  expect(results[0].sourceClass).toBe('official');
  expect(results[0].reasons.length).toBeGreaterThan(0);
});
