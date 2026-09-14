import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Page from '../app/page';

function webResult(index = 1) {
  return {
    origin: 'web' as const,
    sourceClass: 'official' as const,
    verified: true,
    score: 96 - index,
    title: `互联网候选标题 ${index}`,
    source: `example${index}.gov`,
    snippet: '公开网页',
    reasons: ['官方来源'],
    contentLength: 10,
    url: `https://example${index}.gov/a`,
    finalUrl: `https://example${index}.gov/a`,
  };
}

const firstResult = webResult();
const job = {
  id: '00000000-0000-0000-0000-000000000001',
  startUrl: firstResult.finalUrl,
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

test('search shows candidates but does not crawl until the user selects and starts', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: '预算定额',
    results: [firstResult],
    crawl: { state: 'not_started', jobs: [] },
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  render(<Page />);
  submitQuery();

  expect(await screen.findByText('互联网候选标题 1')).toBeInTheDocument();
  expect(screen.getByText('已选择 0 / 3 个来源')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始爬取' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/search', expect.objectContaining({ method: 'POST' }));
});

test('submits only the selected source, polls real counters, and promotes its PDF', async () => {
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/search') {
      return new Response(JSON.stringify({
        query: '预算定额',
        results: [firstResult, webResult(2)],
        crawl: { state: 'not_started', jobs: [] },
      }), { status: 200 });
    }
    if (url === '/api/crawl') {
      expect(JSON.parse(String(init?.body))).toEqual({ query: '预算定额', urls: [firstResult.finalUrl] });
      return new Response(JSON.stringify({ state: 'started', jobs: [job] }), { status: 202 });
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
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<Page />);
  submitQuery();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 1' }));
  expect(screen.getByText('已选择 1 / 3 个来源')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始爬取' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(screen.getByText('已提交 1 个来源，正在等待抓取。')).toBeInTheDocument();
  expect(screen.getAllByText('等待抓取')).toHaveLength(2);

  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('正在抓取：已检查 8 个页面，发现 2 个 PDF，已收录 0 个')).toBeInTheDocument();
  expect(screen.getByText('抓取中')).toBeInTheDocument();
  expect(screen.getByText('8 个页面 · 2 个 PDF · 0 个已收录')).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('已找到并收录新的 PDF，可直接从本站下载。')).toBeInTheDocument();
  expect(screen.getByText('预算定额')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '预览' })).toHaveAttribute(
    'href',
    '/api/library/file?id=51957b6f-1111-2222-3333-444444444444',
  );
  expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute(
    'href',
    '/api/library/file?id=51957b6f-1111-2222-3333-444444444444&download=1',
  );
});

test('limits a batch to three selected sources', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: '预算定额',
    results: [webResult(1), webResult(2), webResult(3), webResult(4)],
    crawl: { state: 'not_started', jobs: [] },
  }), { status: 200 })));

  render(<Page />);
  submitQuery();
  expect(await screen.findByText('互联网候选标题 4')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 3' }));

  expect(screen.getByText('已选择 3 / 3 个来源')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '选择来源 4' })).toBeDisabled();
});

test('a new search clears selection and stops polling the previous batch', async () => {
  vi.useFakeTimers();
  let searchCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/search') {
      searchCalls += 1;
      return new Response(JSON.stringify({
        query: searchCalls === 1 ? '预算定额' : '第二次搜索',
        results: [firstResult],
        crawl: { state: 'not_started', jobs: [] },
      }), { status: 200 });
    }
    if (url === '/api/crawl') {
      return new Response(JSON.stringify({ state: 'started', jobs: [job] }), { status: 202 });
    }
    if (url.startsWith('/api/search/status')) throw new Error('old polling should have been cancelled');
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<Page />);
  submitQuery();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择来源 1' }));
  fireEvent.click(screen.getByRole('button', { name: '开始爬取' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  fireEvent.change(screen.getByLabelText('搜索文件'), { target: { value: '第二次搜索' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

  expect(screen.getByText('已选择 0 / 3 个来源')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/search/status'))).toBe(false);
});
