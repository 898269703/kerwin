import type { CrawlJobRecord, DocumentRepository, SeedSite } from './repositories.ts';
import { runCrawleeTraversal, type TraversalSummary } from './crawler-engine.ts';

export type CrawlRunnerRepo = Pick<DocumentRepository, 'getCrawlJob' | 'getSeedSite' | 'updateCrawlJob'>;
export type TraversalFunction = (input: {
  job: CrawlJobRecord;
  seed: SeedSite;
  repo: DocumentRepository;
  dataRoot: string;
  userAgent: string;
  maxPages: number;
  maxPdfs: number;
}) => Promise<TraversalSummary>;

export async function runCrawlJob(jobId: string, deps: {
  repo: CrawlRunnerRepo & Partial<DocumentRepository>;
  dataRoot: string;
  userAgent: string;
  maxPages: number;
  maxPdfs: number;
  traversal?: TraversalFunction;
}): Promise<TraversalSummary & { status: CrawlJobRecord['status'] }> {
  const job = await deps.repo.getCrawlJob(jobId);
  if (!job) throw new Error(`Crawl job ${jobId} not found`);
  if (!job.seedSiteId) throw new Error('Crawl job has no seed site');
  const seed = await deps.repo.getSeedSite(job.seedSiteId);
  if (!seed) throw new Error(`Seed site ${job.seedSiteId} not found`);
  if (!seed.enabled) throw new Error(`Seed site ${seed.id} is disabled`);

  await deps.repo.updateCrawlJob(jobId, { status: 'running', started: true });
  const traversal = deps.traversal ?? runCrawleeTraversal;
  try {
    const summary = await traversal({
      job,
      seed,
      repo: deps.repo as DocumentRepository,
      dataRoot: deps.dataRoot,
      userAgent: deps.userAgent,
      maxPages: deps.maxPages,
      maxPdfs: deps.maxPdfs,
    });
    const status: CrawlJobRecord['status'] = summary.errorsCount > 0 ? 'partial' : 'succeeded';
    await deps.repo.updateCrawlJob(jobId, {
      status,
      pagesFetched: summary.pagesFetched,
      filesDiscovered: summary.filesDiscovered,
      filesDownloaded: summary.filesDownloaded,
      duplicatesFound: summary.duplicatesFound,
      errorsCount: summary.errorsCount,
      errorSummary: summary.errorSummary,
      finished: true,
    });
    return { ...summary, status };
  } catch (error) {
    await deps.repo.updateCrawlJob(jobId, { status: 'failed', errorsCount: 1, errorSummary: (error as Error).message, finished: true });
    throw error;
  }
}
