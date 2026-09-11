import type { CrawlJob } from './types';

function crawlerConfig(): { base: string; token: string } {
  const base = process.env.CRAWLER_BASE_URL?.trim().replace(/\/$/, '');
  const token = process.env.CRAWLER_API_TOKEN?.trim();
  if (!base || !token) throw new Error('crawler service unavailable');
  return { base, token };
}

async function workerJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const { base, token } = crawlerConfig();
  const response = await fetch(`${base}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`crawler request failed with ${response.status}`);
  return response.json();
}

function toJob(value: unknown): CrawlJob {
  if (!value || typeof value !== 'object') throw new Error('invalid crawler job payload');
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const startUrl = typeof row.startUrl === 'string' ? row.startUrl : '';
  const status = typeof row.status === 'string' ? row.status : '';
  if (!id || !startUrl || !['queued', 'running', 'succeeded', 'partial', 'failed'].includes(status)) {
    throw new Error('invalid crawler job payload');
  }
  return {
    id,
    startUrl,
    status: status as CrawlJob['status'],
    pagesFetched: Number(row.pagesFetched ?? 0) || 0,
    filesDiscovered: Number(row.filesDiscovered ?? 0) || 0,
    filesDownloaded: Number(row.filesDownloaded ?? 0) || 0,
    duplicatesFound: Number(row.duplicatesFound ?? 0) || 0,
    errorsCount: Number(row.errorsCount ?? 0) || 0,
    errorSummary: typeof row.errorSummary === 'string' ? row.errorSummary : null,
    reused: typeof row.reused === 'boolean' ? row.reused : undefined,
  };
}

export async function enqueueSearchDiscovery(url: string, query: string): Promise<CrawlJob> {
  const payload = await workerJson('/v1/search-discovery/jobs', {
    method: 'POST',
    body: JSON.stringify({ url, query, mode: 'auto' }),
  }) as { job?: unknown };
  return toJob(payload.job);
}

export async function getCrawlJob(jobId: string): Promise<CrawlJob> {
  if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) throw new Error('invalid crawl job id');
  const payload = await workerJson(`/v1/crawl/jobs/${encodeURIComponent(jobId)}`) as { job?: unknown };
  return toJob(payload.job);
}
