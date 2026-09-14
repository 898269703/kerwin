import { getVercelOidcTokenSync } from '@vercel/oidc';
import type { CrawlDocument, CrawlJob } from './types';

const DEFAULT_CRAWLER_BASE_URL = 'https://crawler-worker-production.up.railway.app';

export function crawlerConfig(): { base: string; token: string } {
  const base = (process.env.CRAWLER_BASE_URL?.trim() || DEFAULT_CRAWLER_BASE_URL).replace(/\/$/, '');
  let token = process.env.CRAWLER_API_TOKEN?.trim();
  if (!token) {
    try {
      // Read the current function context on each request, not a build-time token.
      token = getVercelOidcTokenSync().trim();
    } catch {
      throw new Error('crawler service unavailable');
    }
  }
  if (!token) throw new Error('crawler service unavailable');
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
  const documents = Array.isArray(row.documents)
    ? row.documents.flatMap((value): CrawlDocument[] => {
      if (!value || typeof value !== 'object') return [];
      const document = value as Record<string, unknown>;
      if (typeof document.id !== 'string' || typeof document.title !== 'string') return [];
      return [{
        id: document.id,
        title: document.title,
        filename: typeof document.filename === 'string' ? document.filename : null,
        documentNumber: typeof document.documentNumber === 'string' ? document.documentNumber : null,
        byteSize: Math.max(0, Number(document.byteSize ?? 0) || 0),
        sourceCount: Math.max(0, Number(document.sourceCount ?? 0) || 0),
      }];
    })
    : undefined;
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
    documents,
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
