import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commitDownloadedFile } from './file-store.ts';
import { downloadPdf, type DownloadedPdf } from './pdf-downloader.ts';
import { extractDocumentNumber } from './document-number.ts';
import { normalizeUrl } from './url-policy.ts';

export type DocumentCandidate = {
  jobId: string;
  url: string;
  referrerUrl: string | null;
  anchorText: string | null;
  allowedHosts: string[];
  maxPdfBytes: number;
};

export type CandidateRepo = {
  upsertDiscoveredLink(input: {
    url: string; normalizedUrl: string; referrerUrl: string | null; sourceHost: string;
    anchorText: string | null; likelyDocument: boolean; ingestionStatus: string;
  }): Promise<void>;
  upsertDocumentByHash(input: {
    sha256: string; storageKey: string; mimeType: string; byteSize: number;
    preferredTitle: string | null; preferredFilename: string | null; documentNumber: string | null;
  }): Promise<{ document: { id: string; storageKey: string }; duplicate: boolean }>;
  upsertDocumentBlob(input: { documentId: string; sha256: string; content: Buffer }): Promise<void>;
  upsertDocumentSource(input: {
    documentId: string; sourceUrl: string; normalizedSourceUrl: string; sourceHost: string;
    referrerUrl: string | null; anchorText: string | null; httpFilename: string | null; lastHttpStatus: number | null;
  }): Promise<void>;
  markDiscoveredStatus(normalizedUrl: string, status: 'downloaded' | 'failed' | 'rejected'): Promise<void>;
};

export async function processDocumentCandidate(candidate: DocumentCandidate, deps: {
  repo: CandidateRepo;
  dataRoot: string;
  downloader?: (input: Parameters<typeof downloadPdf>[0]) => Promise<DownloadedPdf>;
}): Promise<{ downloaded: boolean; duplicate: boolean; documentId: string; storageKey: string }> {
  const normalizedUrl = normalizeUrl(candidate.url);
  const sourceHost = new URL(candidate.url).hostname.toLowerCase();
  await deps.repo.upsertDiscoveredLink({
    url: candidate.url,
    normalizedUrl,
    referrerUrl: candidate.referrerUrl,
    sourceHost,
    anchorText: candidate.anchorText,
    likelyDocument: true,
    ingestionStatus: 'queued',
  });

  const tempDir = join(deps.dataRoot, 'tmp');
  await mkdir(tempDir, { recursive: true });
  const downloader = deps.downloader ?? downloadPdf;
  try {
    const downloaded = await downloader({
      url: candidate.url,
      tempDir,
      maxBytes: candidate.maxPdfBytes,
      allowedHosts: candidate.allowedHosts,
    });
    const committed = await commitDownloadedFile(downloaded.tempPath, downloaded.sha256, deps.dataRoot);
    const title = candidate.anchorText?.trim() || downloaded.httpFilename || new URL(downloaded.finalUrl).pathname.split('/').pop() || null;
    const documentNumber = extractDocumentNumber(`${candidate.anchorText ?? ''} ${downloaded.httpFilename ?? ''} ${title ?? ''}`);
    const upserted = await deps.repo.upsertDocumentByHash({
      sha256: downloaded.sha256,
      storageKey: committed.storageKey,
      mimeType: 'application/pdf',
      byteSize: downloaded.byteSize,
      preferredTitle: title,
      preferredFilename: downloaded.httpFilename,
      documentNumber,
    });
    const content = await readFile(committed.absolutePath);
    await deps.repo.upsertDocumentBlob({ documentId: upserted.document.id, sha256: downloaded.sha256, content });
    await deps.repo.upsertDocumentSource({
      documentId: upserted.document.id,
      sourceUrl: downloaded.finalUrl,
      normalizedSourceUrl: normalizeUrl(downloaded.finalUrl),
      sourceHost: new URL(downloaded.finalUrl).hostname.toLowerCase(),
      referrerUrl: candidate.referrerUrl,
      anchorText: candidate.anchorText,
      httpFilename: downloaded.httpFilename,
      lastHttpStatus: downloaded.statusCode,
    });
    await deps.repo.markDiscoveredStatus(normalizedUrl, 'downloaded');
    return {
      downloaded: true,
      duplicate: upserted.duplicate || committed.existed,
      documentId: upserted.document.id,
      storageKey: upserted.document.storageKey || committed.storageKey,
    };
  } catch (error) {
    await deps.repo.markDiscoveredStatus(normalizedUrl, 'failed').catch(() => undefined);
    throw error;
  }
}
