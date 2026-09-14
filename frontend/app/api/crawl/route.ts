import { enqueueSearchDiscovery } from '../../../lib/crawler-client';
import type { CrawlJob } from '../../../lib/types';
import { searchWeb } from '../../../lib/web-search';

export const dynamic = 'force-dynamic';

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function normalizePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') || isPrivateIpv4(hostname) ||
      hostname === '[::1]' || hostname === '::1' || hostname.startsWith('[fc') ||
      hostname.startsWith('[fd') || hostname.startsWith('[fe8') || hostname.startsWith('[fe9') ||
      hostname.startsWith('[fea') || hostname.startsWith('[feb')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON object required' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'JSON object required' }, { status: 400 });
  }
  const input = body as { query?: unknown; urls?: unknown };
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const rawUrls = Array.isArray(input.urls) ? input.urls : [];
  const urls = rawUrls.map(normalizePublicUrl);
  if (!query || query.length > 200 || rawUrls.length < 1 || rawUrls.length > 3 || urls.some((url) => !url)) {
    return Response.json({ error: 'query and 1 to 3 public HTTP(S) URLs are required' }, { status: 400 });
  }
  const selectedUrls = urls as string[];
  if (new Set(selectedUrls).size !== selectedUrls.length) {
    return Response.json({ error: 'selected URLs must be unique' }, { status: 400 });
  }

  let candidates: Awaited<ReturnType<typeof searchWeb>>;
  try {
    candidates = await searchWeb(query);
  } catch {
    return Response.json({ error: '互联网候选校验暂时不可用，请稍后重试。' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const eligibleUrls = new Set(candidates.flatMap((candidate) => {
    const normalized = normalizePublicUrl(candidate.finalUrl ?? candidate.url);
    return normalized ? [normalized] : [];
  }));
  if (selectedUrls.some((url) => !eligibleUrls.has(url))) {
    return Response.json({ error: '所选来源不属于当前互联网搜索结果，请重新搜索后选择。' }, { status: 400 });
  }

  const settled = await Promise.allSettled(
    selectedUrls.map((url) => Promise.resolve().then(() => enqueueSearchDiscovery(url, query))),
  );
  const jobs = settled.flatMap((result): CrawlJob[] => result.status === 'fulfilled' ? [result.value] : []);
  const failures = settled.length - jobs.length;

  if (jobs.length === 0) {
    return Response.json({ error: '选中来源暂时无法开始抓取，请稍后重试。' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }

  return Response.json({
    state: 'started',
    jobs,
    ...(failures > 0 ? { warnings: ['部分选中来源未能启动抓取。'] } : {}),
  }, {
    status: 202,
    headers: { 'cache-control': 'no-store' },
  });
}
