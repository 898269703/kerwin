import type { SearchResult, SourceClass } from './types';

type WebCandidate = {
  title?: string;
  url?: string;
  content?: string;
};

type SearxPayload = {
  results?: WebCandidate[];
};

const DEFAULT_SEARXNG_BASE_URL = 'https://searxng-production-00a4.up.railway.app';

const OFFICIAL_HOSTS = [
  'sgcc.com.cn',
  'csg.cn',
  'nea.gov.cn',
  'ndrc.gov.cn',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function isDirectPdf(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function classifySource(url: string): SourceClass {
  const host = hostOf(url);
  if (!host) return 'other';
  if (
    host.endsWith('.gov.cn') ||
    host.endsWith('.gov') ||
    OFFICIAL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) return 'official';
  if (
    host.endsWith('.edu.cn') ||
    host.endsWith('.org.cn') ||
    host.includes('ceec') ||
    host.includes('powerchina')
  ) return 'institutional';
  return 'public';
}

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase().trim();
  const pieces = normalized.split(/\s+/).filter(Boolean);
  return pieces.length > 0 ? pieces : [normalized];
}

function scoreCandidate(query: string, candidate: Required<WebCandidate>, sourceClass: SourceClass): number {
  const title = candidate.title.toLowerCase();
  const content = candidate.content.toLowerCase();
  const terms = queryTerms(query);
  let score = 20;

  if (sourceClass === 'official') score += 28;
  else if (sourceClass === 'institutional') score += 18;
  else if (sourceClass === 'public') score += 8;

  if (isDirectPdf(candidate.url)) score += 22;

  const compactQuery = query.toLowerCase().replace(/\s+/g, '');
  if (compactQuery && title.replace(/\s+/g, '').includes(compactQuery)) score += 22;
  else {
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const contentHits = terms.filter((term) => content.includes(term)).length;
    score += Math.min(18, titleHits * 8 + contentHits * 3);
  }

  return Math.max(0, Math.min(100, score));
}

export function rankWebCandidates(query: string, candidates: WebCandidate[]): SearchResult[] {
  return candidates.flatMap((candidate): SearchResult[] => {
    const url = candidate.url?.trim() || '';
    const title = candidate.title?.trim() || '';
    if (!url || !title || !/^https?:\/\//i.test(url)) return [];

    const sourceClass = classifySource(url);
    const content = candidate.content?.trim() || '';
    const directPdf = isDirectPdf(url);
    const reasons: string[] = [];
    if (sourceClass === 'official') reasons.push('官方来源');
    else if (sourceClass === 'institutional') reasons.push('机构来源');
    if (directPdf) reasons.push('PDF 直链');
    if (reasons.length === 0) reasons.push('公开互联网来源');

    return [{
      origin: 'web',
      sourceClass,
      verified: sourceClass === 'official' || sourceClass === 'institutional' || directPdf,
      score: scoreCandidate(query, { title, url, content }, sourceClass),
      title,
      source: hostOf(url) || url,
      snippet: content || '公开网页搜索结果',
      reasons,
      contentLength: content.length,
      url,
      finalUrl: url,
    }];
  }).sort((a, b) => b.score - a.score);
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const raw = process.env.SEARXNG_BASE_URL ?? process.env.SEARCH_BASE_URL ?? DEFAULT_SEARXNG_BASE_URL;
  const base = raw.trim().replace(/\/$/, '');

  const params = new URLSearchParams({ q: query, format: 'json', categories: 'general' });
  const response = await fetch(`${base}/search?${params.toString()}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`web search failed with ${response.status}`);
  const payload = (await response.json()) as SearxPayload;
  return rankWebCandidates(query, payload.results ?? []);
}
