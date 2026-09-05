export type RobotsPolicy = { allowed(url: string): boolean; warning: string | null; crawlDelaySeconds: number | null };

type ParserLike = { isAllowed(url: string, userAgent?: string): boolean | undefined; getCrawlDelay?(userAgent?: string): number | undefined };
type ParserFactory = (robotsUrl: string, body: string) => ParserLike;

export function robotsUrlFor(input: string): string {
  const url = new URL(input);
  return `${url.protocol}//${url.host}/robots.txt`;
}

export async function getRobotsPolicy(input: string, options: {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  parserFactory?: ParserFactory;
} = {}): Promise<RobotsPolicy> {
  const robotsUrl = robotsUrlFor(input);
  const userAgent = options.userAgent ?? 'PDF-Finder-Crawler';
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(robotsUrl, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    return { allowed: () => false, warning: `robots.txt fetch failed: ${(error as Error).message}`, crawlDelaySeconds: null };
  }
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel().catch(() => undefined);
    return { allowed: () => true, warning: null, crawlDelaySeconds: null };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { allowed: () => false, warning: `robots.txt returned HTTP ${response.status}`, crawlDelaySeconds: null };
  }
  const body = await response.text();
  let parserFactory = options.parserFactory;
  if (!parserFactory) {
    const module = await import('robots-parser');
    parserFactory = module.default as unknown as ParserFactory;
  }
  const parsed = parserFactory(robotsUrl, body);
  const delay = parsed.getCrawlDelay?.(userAgent);
  return {
    allowed: (url) => parsed.isAllowed(url, userAgent) !== false,
    warning: null,
    crawlDelaySeconds: typeof delay === 'number' && Number.isFinite(delay) ? delay : null,
  };
}
