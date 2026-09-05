import { assertPublicHttpUrl, normalizeUrl } from './url-policy.ts';
import { classifyLink, isAllowedPath } from './link-classifier.ts';
import { processDocumentCandidate } from './crawl-job.ts';
import type { CrawlJobRecord, DocumentRepository, SeedSite } from './repositories.ts';

export type TraversalSummary = {
  pagesFetched: number;
  filesDiscovered: number;
  filesDownloaded: number;
  duplicatesFound: number;
  errorsCount: number;
  errorSummary: string | null;
};

export async function runCrawleeTraversal(input: {
  job: CrawlJobRecord;
  seed: SeedSite;
  repo: DocumentRepository;
  dataRoot: string;
  userAgent: string;
  maxPages: number;
  maxPdfs: number;
}): Promise<TraversalSummary> {
  const { CheerioCrawler, RequestQueue } = await import('crawlee');
  const counters = { pagesFetched: 0, filesDiscovered: 0, filesDownloaded: 0, duplicatesFound: 0, errorsCount: 0 };
  const errors: string[] = [];
  const maxPages = Math.max(1, Math.min(input.maxPages, 500));
  const maxPdfs = Math.max(1, Math.min(input.maxPdfs, 100));
  const queue = await RequestQueue.open(`crawl-${input.job.id}`);

  const start = await assertPublicHttpUrl(input.job.startUrl, input.seed.allowedHosts);
  if (!isAllowedPath(start.pathname, input.seed.excludePatterns, input.seed.includePatterns)) throw new Error('Start URL path is excluded by seed rules');
  await queue.addRequest({ url: start.toString(), userData: { depth: 0 } });

  const addError = (message: string) => {
    counters.errorsCount += 1;
    if (errors.length < 20) errors.push(message.slice(0, 400));
  };

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    minConcurrency: 1,
    maxConcurrency: Math.max(1, Math.min(input.seed.maxConcurrency, 4)),
    maxRequestsPerMinute: Math.max(1, Math.min(input.seed.maxRequestsPerMinute, 120)),
    maxRequestsPerCrawl: maxPages,
    maxRequestRetries: 2,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 90,
    respectRobotsTxtFile: { userAgent: input.userAgent },
    retryOnBlocked: false,
    useSessionPool: false,
    preNavigationHooks: [async ({ request }: any) => {
      await assertPublicHttpUrl(request.url, input.seed.allowedHosts);
    }],
    requestHandler: async ({ request, $, response }: any) => {
      const loadedUrl = request.loadedUrl || request.url;
      let loaded: URL;
      try {
        loaded = await assertPublicHttpUrl(loadedUrl, input.seed.allowedHosts);
      } catch (error) {
        addError(`unsafe/final URL ${loadedUrl}: ${(error as Error).message}`);
        return;
      }
      const depth = Number(request.userData?.depth ?? 0);
      counters.pagesFetched += 1;
      const pageTitle = $('title').first().text().trim() || null;
      await input.repo.recordCrawlPage({
        jobId: input.job.id,
        url: loadedUrl,
        normalizedUrl: normalizeUrl(loadedUrl),
        statusCode: Number(response?.statusCode ?? 200),
        contentType: String(response?.headers?.['content-type'] ?? 'text/html'),
        depth,
        pageTitle,
        error: null,
      }).catch((error) => addError(`page record ${loadedUrl}: ${(error as Error).message}`));

      const pageCandidates: Array<{ url: string; depth: number }> = [];
      const documentCandidates: Array<{ url: string; anchorText: string | null }> = [];
      $('a[href]').each((_index: number, element: any) => {
        const href = $(element).attr('href');
        if (!href) return;
        let resolved: URL;
        try { resolved = new URL(href, loaded); } catch { return; }
        if (!['http:', 'https:'].includes(resolved.protocol)) return;
        const hostname = resolved.hostname.toLowerCase();
        if (!input.seed.allowedHosts.map((h) => h.toLowerCase()).includes(hostname)) return;
        if (!isAllowedPath(resolved.pathname, input.seed.excludePatterns, input.seed.includePatterns)) return;
        const anchorText = $(element).text().replace(/\s+/g, ' ').trim() || null;
        const classification = classifyLink({ url: resolved.toString(), anchorText, downloadAttribute: $(element).attr('download') ?? null });
        if (classification.kind === 'document') documentCandidates.push({ url: resolved.toString(), anchorText });
        else if (classification.kind === 'page' && depth < input.seed.maxDepth) pageCandidates.push({ url: resolved.toString(), depth: depth + 1 });
      });

      for (const candidate of documentCandidates) {
        if (counters.filesDiscovered >= maxPdfs) break;
        counters.filesDiscovered += 1;
        try {
          const result = await processDocumentCandidate({
            jobId: input.job.id,
            url: candidate.url,
            referrerUrl: loadedUrl,
            anchorText: candidate.anchorText,
            allowedHosts: input.seed.allowedHosts,
            maxPdfBytes: input.seed.maxPdfBytes,
          }, { repo: input.repo, dataRoot: input.dataRoot });
          if (result.downloaded) counters.filesDownloaded += 1;
          if (result.duplicate) counters.duplicatesFound += 1;
        } catch (error) {
          addError(`document ${candidate.url}: ${(error as Error).message}`);
        }
      }

      for (const next of pageCandidates) {
        try {
          const safe = await assertPublicHttpUrl(next.url, input.seed.allowedHosts);
          await queue.addRequest({ url: safe.toString(), userData: { depth: next.depth } });
        } catch (error) {
          addError(`enqueue ${next.url}: ${(error as Error).message}`);
        }
      }
    },
    failedRequestHandler: async ({ request }: any) => {
      addError(`page failed ${request.url}: ${(request.errorMessages ?? []).slice(-1)[0] ?? 'request failed'}`);
      await input.repo.recordCrawlPage({
        jobId: input.job.id,
        url: request.url,
        normalizedUrl: normalizeUrl(request.url),
        statusCode: null,
        contentType: null,
        depth: Number(request.userData?.depth ?? 0),
        pageTitle: null,
        error: (request.errorMessages ?? []).slice(-1)[0] ?? 'request failed',
      }).catch(() => undefined);
    },
  });

  await crawler.run();
  return { ...counters, errorSummary: errors.length ? errors.join('\n') : null };
}
