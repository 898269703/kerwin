import { processDocumentCandidate } from './crawl-job.ts';
import type { SeedSite } from './repositories.ts';

export type IngestRunnerRepo = {
  updateCrawlJob(id: string, patch: {
    status?: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
    filesDiscovered?: number;
    filesDownloaded?: number;
    duplicatesFound?: number;
    errorsCount?: number;
    errorSummary?: string | null;
    started?: boolean;
    finished?: boolean;
  }): Promise<void>;
};

export async function runIngestJob(input: {
  jobId: string;
  url: string;
  referrerUrl: string | null;
  seed: Pick<SeedSite, 'allowedHosts' | 'maxPdfBytes'>;
}, deps: {
  repo: IngestRunnerRepo & any;
  dataRoot: string;
  processCandidate?: typeof processDocumentCandidate;
}) {
  await deps.repo.updateCrawlJob(input.jobId, { status: 'running', started: true });
  const processCandidate = deps.processCandidate ?? processDocumentCandidate;
  try {
    const result = await processCandidate({
      jobId: input.jobId,
      url: input.url,
      referrerUrl: input.referrerUrl,
      anchorText: null,
      allowedHosts: input.seed.allowedHosts,
      maxPdfBytes: input.seed.maxPdfBytes,
    }, {
      repo: deps.repo,
      dataRoot: deps.dataRoot,
    });
    const duplicatesFound = result.duplicate ? 1 : 0;
    await deps.repo.updateCrawlJob(input.jobId, {
      status: 'succeeded',
      filesDiscovered: 1,
      filesDownloaded: result.downloaded ? 1 : 0,
      duplicatesFound,
      errorsCount: 0,
      errorSummary: null,
      finished: true,
    });
    return { ...result, status: 'succeeded' as const, duplicatesFound };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.repo.updateCrawlJob(input.jobId, {
      status: 'failed',
      filesDiscovered: 1,
      filesDownloaded: 0,
      duplicatesFound: 0,
      errorsCount: 1,
      errorSummary: message,
      finished: true,
    });
    throw error;
  }
}
