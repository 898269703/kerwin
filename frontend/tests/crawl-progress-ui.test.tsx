import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Page from '../app/page';

const webResult = {
  origin: 'web' as const,
  sourceClass: 'official' as const,
  verified: true,
  score: 95,
  title: '互联网候选标题',
  source: 'example.gov',
  snippet: '公开网页',
  reasons: ['官方来源'],
  contentLength: 10,
  url: 'https://example.gov/a',
  finalUrl: 'https://example.gov/a',
};

const job = {
  id: '00000000-0000-0000-0000-000000000001',
  startUrl: webResult.finalUrl,
  status: 'queued' as const,
  pagesFetched: 0,
  filesDiscovered: 0,
  filesDownloaded: 0,
  duplicatesFound: 0,
  errorsCount: 0,
};

function submitQuery() {
  fireEvent.change(screen.getByLabelText('搜索文件'), { target: { value: '预算定额' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('shows web results immediately while deep crawl is queued', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: '预算定额',
    results: [webResult],
    crawl: { state: 'started', jobs: [job] },
  }), { status: 200 })));

  render(<Page />);
  submitQuery();

  expect(await screen.findByText('正在准备深度查找…')).toBeInTheDocument();
  expect(screen.getByText('互联网候选标题')).toBeInTheDocument();
});

test('polls real progress and promotes a newly ingested library PDF', async () => {
  vi.useFakeTimers();
  const libraryResult = {
    origin: 'library' as const,
    sourceClass: 'library' as const,
    verified: true,
    score: 99,
    title: '预算定额',
    source: '本站文件库',
    snippet: 'budget.pdf',
    reasons: ['本站已收录'],
    contentLength: 2048,
    libraryId: '51957b6f-1111-2222-3333-444444444444',
  };

  let statusCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/search' && init?.method === 'POST') {
      return new Response(JSON.stringify({
        query: '预算定额',
        results: [webResult],
        crawl: { state: 'started', jobs: [job] },
      }), { status: 200 });
    }
    if (url.startsWith('/api/search/status')) {
      statusCalls += 1;
      if (statusCalls === 1) {
        return new Response(JSON.stringify({
          state: 'running',
          jobs: [{ ...job, status: 'running', pagesFetched: 8, filesDiscovered: 2 }],
          libraryResults: [],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        state: 'complete',
        jobs: [{ ...job, status: 'succeeded', pagesFetched: 12, filesDiscovered: 2, filesDownloaded: 1 }],
        libraryResults: [libraryResult],
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  render(<Page />);
  submitQuery();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('正在抓取公开来源：已检查 8 个页面，发现 2 个 PDF')).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('已找到并收录新的 PDF，可直接从本站下载。')).toBeInTheDocument();
  expect(screen.getByText('预算定额')).toBeInTheDocument();
  expect(screen.getByText('本站已收录', { selector: '.topmark' })).toBeInTheDocument();
});
