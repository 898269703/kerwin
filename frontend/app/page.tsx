'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { mergePostCrawlResults } from '../lib/result-merge';
import type { CrawlJob, SearchResponse, SearchResult } from '../lib/types';

const examples = [
  '国家电网财〔2014〕156号',
  '输变电工程 全生命周期 碳排放 核算',
  '电力建设工程 预算定额',
];

type CrawlView =
  | { kind: 'queued'; pages: 0; pdfs: 0 }
  | { kind: 'running'; pages: number; pdfs: number }
  | { kind: 'hit'; pages: number; pdfs: number }
  | { kind: 'no-hit'; pages: number; pdfs: number }
  | { kind: 'unavailable'; pages: number; pdfs: number };

type StatusResponse = {
  state: 'running' | 'complete';
  jobs: CrawlJob[];
  libraryResults: SearchResult[];
  warnings?: string[];
};

function aggregateProgress(jobs: CrawlJob[]) {
  return jobs.reduce(
    (sum, job) => ({
      pages: sum.pages + job.pagesFetched,
      pdfs: sum.pdfs + job.filesDiscovered,
    }),
    { pages: 0, pdfs: 0 },
  );
}

function mergeWarnings(current: string[] | undefined, incoming: string[] | undefined) {
  return [...new Set([...(current ?? []), ...(incoming ?? [])])];
}

export default function Page() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [crawlView, setCrawlView] = useState<CrawlView | null>(null);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPollTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => () => {
    generationRef.current += 1;
    clearPollTimer();
  }, []);

  function schedulePoll(value: string, jobIds: string[], generation: number, startedAt: number) {
    if (generation !== generationRef.current) return;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= 150_000) {
      setCrawlView((view) => ({
        kind: 'unavailable',
        pages: view?.pages ?? 0,
        pdfs: view?.pdfs ?? 0,
      }));
      return;
    }

    const delay = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? 8_000
      : elapsed >= 30_000 ? 4_000 : 2_000;

    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      if (generation !== generationRef.current) return;

      const params = new URLSearchParams({ q: value });
      for (const id of jobIds) params.append('jobId', id);

      try {
        const response = await fetch(`/api/search/status?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json() as StatusResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || '深度查找状态获取失败');
        if (generation !== generationRef.current) return;

        const progress = aggregateProgress(payload.jobs ?? []);
        if (payload.state === 'complete') {
          setData((current) => {
            if (!current) return current;
            const libraryResults = payload.libraryResults ?? [];
            return {
              ...current,
              results: libraryResults.length > 0
                ? mergePostCrawlResults(libraryResults, current.results)
                : current.results,
              warnings: mergeWarnings(current.warnings, payload.warnings),
            };
          });
          setCrawlView({
            kind: (payload.libraryResults?.length ?? 0) > 0 ? 'hit' : 'no-hit',
            ...progress,
          });
          return;
        }

        setData((current) => current ? {
          ...current,
          warnings: mergeWarnings(current.warnings, payload.warnings),
        } : current);
        setCrawlView({ kind: 'running', ...progress });
        schedulePoll(value, jobIds, generation, startedAt);
      } catch {
        if (generation !== generationRef.current) return;
        setCrawlView((view) => ({
          kind: 'unavailable',
          pages: view?.pages ?? 0,
          pdfs: view?.pdfs ?? 0,
        }));
      }
    }, delay);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    if (!value || loading) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    clearPollTimer();
    setLoading(true);
    setError('');
    setCrawlView(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: value }),
      });
      const payload = await response.json() as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(payload?.error || '搜索失败');
      if (generation !== generationRef.current) return;

      setData(payload);
      const jobs = payload.crawl?.jobs ?? [];
      if (payload.crawl?.state === 'started' && jobs.length > 0) {
        setCrawlView({ kind: 'queued', pages: 0, pdfs: 0 });
        schedulePoll(value, jobs.map((job) => job.id), generation, Date.now());
      } else if (payload.crawl?.state === 'unavailable') {
        setCrawlView({ kind: 'unavailable', pages: 0, pdfs: 0 });
      }
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err instanceof Error ? err.message : '搜索失败');
      }
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }

  function crawlCopy(view: CrawlView) {
    if (view.kind === 'queued') return '正在准备深度查找…';
    if (view.kind === 'running') return `正在抓取公开来源：已检查 ${view.pages} 个页面，发现 ${view.pdfs} 个 PDF`;
    if (view.kind === 'hit') return '已找到并收录新的 PDF，可直接从本站下载。';
    if (view.kind === 'no-hit') return '深度查找已完成，暂未发现新的可下载 PDF。';
    return '深度查找暂时不可用，已保留当前互联网搜索结果。';
  }

  return (
    <main>
      <header className="brand inner">
        <div className="logo">PDF</div>
        <div>
          <strong>PDF Finder</strong>
          <div className="hint">自有库优先 · 文号强匹配 · 官方来源优先</div>
        </div>
      </header>

      <section className="hero">
        <div className="inner">
          <p className="eyebrow">技经文件获取</p>
          <h1>找到你真正需要的 PDF</h1>
          <p className="subtitle">优先返回已收录文件；未收录时继续从公开互联网查找可信来源。</p>
          <form className="searchbox" onSubmit={submit}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：国家电网财〔2014〕156号"
              aria-label="搜索文件"
            />
            <button type="submit" disabled={loading}>{loading ? '搜索中…' : '搜索'}</button>
          </form>
          <div className="examples" aria-label="搜索示例">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuery(example)}>{example}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="results inner" aria-live="polite">
        {error && <div className="alert error">{error}</div>}
        {crawlView && <div className={`crawl-status ${crawlView.kind}`}>{crawlCopy(crawlView)}</div>}
        {data?.warnings?.map((warning) => <div className="alert warn" key={warning}>{warning}</div>)}
        {data && <div className="summary">找到 {data.results.length} 个结果</div>}
        {data?.results.map((result, index) => (
          <article className="card" key={`${result.libraryId || result.finalUrl || result.url || result.title}-${index}`}>
            <div className="top">
              <span className="topmark">{result.origin === 'library' ? '本站已收录' : '互联网来源'}</span>
              <div className="meta">
                <span className="badge">{result.sourceClass}</span>
                {result.verified && <span className="badge verified">已验证</span>}
                <span className="muted">相关度 {Math.round(result.score)}</span>
              </div>
            </div>
            <h2>{result.title}</h2>
            <p>{result.snippet}</p>
            <div className="source">{result.source}</div>
            {result.reasons.length > 0 && <div className="reasons">{result.reasons.join(' · ')}</div>}
            <div className="actions">
              {result.libraryId ? (
                <>
                  <a className="primary" href={`/api/library/file?id=${encodeURIComponent(result.libraryId)}`} target="_blank" rel="noreferrer">预览</a>
                  <a href={`/api/library/file?id=${encodeURIComponent(result.libraryId)}&download=1`}>下载</a>
                </>
              ) : (
                <a className="primary" href={result.finalUrl || result.url} target="_blank" rel="noreferrer">打开来源</a>
              )}
            </div>
          </article>
        ))}
        {data && data.results.length === 0 && <div className="empty">暂未找到匹配文件。</div>}
      </section>
    </main>
  );
}
