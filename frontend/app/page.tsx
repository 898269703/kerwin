'use client';

import { FormEvent, useState } from 'react';
import type { SearchResponse } from '../lib/types';

const examples = [
  '国家电网财〔2014〕156号',
  '输变电工程 全生命周期 碳排放 核算',
  '电力建设工程 预算定额',
];

export default function Page() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || '搜索失败');
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
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
