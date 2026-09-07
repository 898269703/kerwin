import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processDocumentCandidate } from '../src/crawl-job.ts';
import { createHttpServer } from '../src/http-server.ts';

const DOC_ID = '51957b6f-92ee-4785-98b5-9b2e34620c37';
const SHA = 'a'.repeat(64);

test('a downloaded PDF is also persisted as a database blob', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-finder-blob-'));
  let blob: Buffer | null = null;
  try {
    const tempPath = join(root, 'candidate.part');
    await writeFile(tempPath, Buffer.from('%PDF-test-body'));
    const repo = {
      async upsertDiscoveredLink() {},
      async upsertDocumentByHash() { return { document: { id: DOC_ID, storageKey: `pdfs/aa/aa/${SHA}.pdf` }, duplicate: false }; },
      async upsertDocumentSource() {},
      async markDiscoveredStatus() {},
      async upsertDocumentBlob(input: { content: Buffer }) { blob = input.content; },
    };
    await processDocumentCandidate({
      jobId: 'job', url: 'https://example.com/file.pdf', referrerUrl: null, anchorText: 'file.pdf',
      allowedHosts: ['example.com'], maxPdfBytes: 10_000,
    }, {
      repo: repo as never,
      dataRoot: root,
      downloader: async () => ({ tempPath, finalUrl: 'https://example.com/file.pdf', sha256: SHA, byteSize: 14, httpFilename: 'file.pdf', statusCode: 200 }),
    });
    assert.ok(blob);
    assert.equal(blob!.subarray(0, 5).toString(), '%PDF-');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public file endpoint serves database blob when the disk copy is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-finder-http-'));
  const payload = Buffer.from('%PDF-database-copy');
  const repo = {
    async getDocumentById() { return { id: DOC_ID, sha256: SHA, storageKey: `pdfs/aa/aa/${SHA}.pdf`, mimeType: 'application/pdf', byteSize: payload.length, preferredTitle: 'file.pdf', preferredFilename: 'file.pdf', documentNumber: null }; },
    async getDocumentBlob() { return payload; },
  };
  const server = createHttpServer({ repo: repo as never, apiToken: 'secret', dataRoot: root, healthCheck: async () => true, enqueueJob: async () => {} });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/public/file?id=${DOC_ID}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/pdf/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
