import type { AppConfig } from './config.ts';
import { runCrawlJob } from './crawl-runner.ts';
import { runIngestJob } from './ingest-runner.ts';
import type { DocumentRepository, SeedSite } from './repositories.ts';

export function createRuntimeCallbacks(deps: {
  queue: { push(task: () => Promise<void>): void };
  repo: DocumentRepository;
  config: Pick<AppConfig, 'dataDir' | 'userAgent' | 'maxPagesPerJob' | 'maxPdfsPerJob'>;
  runCrawl?: typeof runCrawlJob;
  runIngest?: typeof runIngestJob;
}) {
  const runCrawl = deps.runCrawl ?? runCrawlJob;
  const runIngest = deps.runIngest ?? runIngestJob;

  return {
    async enqueueJob(jobId: string): Promise<void> {
      deps.queue.push(async () => {
        await runCrawl(jobId, {
          repo: deps.repo,
          dataRoot: deps.config.dataDir,
          userAgent: deps.config.userAgent,
          maxPages: deps.config.maxPagesPerJob,
          maxPdfs: deps.config.maxPdfsPerJob,
        });
      });
    },

    async enqueueIngest(jobId: string, url: string, referrerUrl: string | null, seed: SeedSite): Promise<void> {
      deps.queue.push(async () => {
        await runIngest({ jobId, url, referrerUrl, seed }, {
          repo: deps.repo,
          dataRoot: deps.config.dataDir,
        });
      });
    },
  };
}
