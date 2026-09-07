import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { commitDownloadedFile } from './file-store.ts';
import { downloadPdf } from './pdf-downloader.ts';
import type { DocumentRecord, DocumentRepository, SeedSite } from './repositories.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(payload.length), 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required');
  return parsed as Record<string, unknown>;
}

function authorized(req: IncomingMessage, token: string): boolean {
  return (req.headers.authorization ?? '') === `Bearer ${token}`;
}

function safeFilename(input: string | null | undefined): string {
  const value = (input ?? 'document.pdf').replace(/[\r\n"\\/]/g, '_').trim();
  return value || 'document.pdf';
}

function parseLimit(url: URL, max = 50): number {
  return Math.min(max, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
}

function pdfHeaders(doc: DocumentRecord, byteLength: number, disposition: 'attachment' | 'inline'): Record<string, string> {
  const filename = safeFilename(doc.preferredFilename ?? doc.preferredTitle);
  return {
    'content-type': 'application/pdf',
    'content-length': String(byteLength),
    'content-disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'x-content-type-options': 'nosniff',
    'cache-control': disposition === 'inline' ? 'public, max-age=3600' : 'private, max-age=0, must-revalidate',
  };
}

async function sendDocumentSearch(res: ServerResponse, repo: DocumentRepository, q: string, limit: number, publicPath: boolean): Promise<void> {
  const rows = await repo.searchDocuments(q, limit);
  sendJson(res, 200, {
    query: q,
    results: rows.map((row) => ({
      origin: 'library', id: row.id,
      title: row.preferredTitle ?? row.preferredFilename ?? row.documentNumber ?? '未命名 PDF',
      filename: row.preferredFilename, documentNumber: row.documentNumber, byteSize: row.byteSize,
      sourceCount: row.sourceCount, score: row.score,
      downloadPath: publicPath ? `/public/file?id=${encodeURIComponent(row.id)}` : `/v1/documents/${row.id}/file`,
    })),
  });
}

async function recoverDocumentBlob(doc: DocumentRecord, repo: DocumentRepository, dataRoot: string): Promise<Buffer | null> {
  const sources = await repo.getDocumentSources(doc.id);
  const tempDir = join(dataRoot, 'tmp');
  await mkdir(tempDir, { recursive: true });
  for (const source of sources) {
    const seed = await repo.findSeedForHost(source.sourceHost).catch(() => null);
    if (!seed?.enabled) continue;
    try {
      const downloaded = await downloadPdf({
        url: source.sourceUrl,
        tempDir,
        maxBytes: seed.maxPdfBytes,
        allowedHosts: seed.allowedHosts,
      });
      if (downloaded.sha256 !== doc.sha256) {
        await unlink(downloaded.tempPath).catch(() => undefined);
        continue;
      }
      const committed = await commitDownloadedFile(downloaded.tempPath, downloaded.sha256, dataRoot);
      const content = await readFile(committed.absolutePath);
      await repo.upsertDocumentBlob({ documentId: doc.id, sha256: doc.sha256, content });
      return content;
    } catch {
      continue;
    }
  }
  return null;
}

async function streamStoredPdf(
  res: ServerResponse,
  repo: DocumentRepository,
  dataRoot: string,
  documentId: string,
  disposition: 'attachment' | 'inline',
  recover: (doc: DocumentRecord) => Promise<Buffer | null>,
): Promise<void> {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) return sendJson(res, 404, { error: 'document not found' });
  if (!doc.storageKey.startsWith('pdfs/')) return sendJson(res, 500, { error: 'invalid storage key' });
  const root = resolve(dataRoot);
  const absolute = resolve(root, doc.storageKey);
  if (!absolute.startsWith(root + sep)) return sendJson(res, 500, { error: 'invalid storage path' });

  const info = await stat(absolute).catch(() => null);
  if (info?.isFile()) {
    res.writeHead(200, pdfHeaders(doc, info.size, disposition));
    createReadStream(absolute).pipe(res);
    return;
  }

  let blob = await repo.getDocumentBlob(documentId);
  if (!blob) blob = await recover(doc);
  if (!blob) return sendJson(res, 404, { error: 'stored file missing' });
  res.writeHead(200, pdfHeaders(doc, blob.length, disposition));
  res.end(blob);
}

export function createHttpServer(deps: {
  repo: DocumentRepository;
  apiToken: string;
  dataRoot: string;
  healthCheck: () => Promise<boolean>;
  enqueueJob: (jobId: string) => Promise<void>;
  enqueueIngest?: (jobId: string, url: string, referrerUrl: string | null, seed: SeedSite) => Promise<void>;
  recoverMissingDocument?: (doc: DocumentRecord) => Promise<Buffer | null>;
}) {
  const recover = deps.recoverMissingDocument ?? ((doc: DocumentRecord) => recoverDocumentBlob(doc, deps.repo, deps.dataRoot));
  return createServer(async (req, res) => {
    try {
      const base = `http://${req.headers.host ?? 'localhost'}`;
      const url = new URL(req.url ?? '/', base);

      if (url.pathname === '/health' && req.method === 'GET') {
        const ok = await deps.healthCheck().catch(() => false);
        return sendJson(res, ok ? 200 : 503, { ok });
      }

      if (url.pathname === '/public/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (!q || q.length > 200) return sendJson(res, 400, { error: 'q is required and must be <= 200 characters' });
        await sendDocumentSearch(res, deps.repo, q, parseLimit(url, 20), true);
        return;
      }

      if (url.pathname === '/public/file' && req.method === 'GET') {
        const id = (url.searchParams.get('id') ?? '').trim();
        if (!/^[0-9a-fA-F-]{36}$/.test(id)) return sendJson(res, 400, { error: 'valid id is required' });
        await streamStoredPdf(res, deps.repo, deps.dataRoot, id, 'inline', recover);
        return;
      }

      if (url.pathname.startsWith('/v1/') && !authorized(req, deps.apiToken)) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }

      if (url.pathname === '/v1/documents/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (!q) return sendJson(res, 400, { error: 'q is required' });
        await sendDocumentSearch(res, deps.repo, q, parseLimit(url), false);
        return;
      }

      const fileMatch = url.pathname.match(/^\/v1\/documents\/([0-9a-fA-F-]+)\/file$/);
      if (fileMatch && req.method === 'GET') {
        await streamStoredPdf(res, deps.repo, deps.dataRoot, fileMatch[1]!, 'attachment', recover);
        return;
      }

      const docMatch = url.pathname.match(/^\/v1\/documents\/([0-9a-fA-F-]+)$/);
      if (docMatch && req.method === 'GET') {
        const doc = await deps.repo.getDocumentById(docMatch[1]!);
        if (!doc) return sendJson(res, 404, { error: 'document not found' });
        const sources = await deps.repo.getDocumentSources(doc.id);
        return sendJson(res, 200, { document: doc, sources });
      }

      if (url.pathname === '/v1/crawl/jobs' && req.method === 'POST') {
        const body = await readJson(req);
        const seedSiteId = typeof body.seedSiteId === 'string' ? body.seedSiteId : '';
        if (!seedSiteId) return sendJson(res, 400, { error: 'seedSiteId is required' });
        const seed = await deps.repo.getSeedSite(seedSiteId);
        if (!seed || !seed.enabled) return sendJson(res, 404, { error: 'enabled seed site not found' });
        const startUrl = typeof body.startUrl === 'string' && body.startUrl.trim() ? body.startUrl.trim() : seed.baseUrl;
        const job = await deps.repo.createCrawlJob({ seedSiteId: seed.id, triggerType: 'seed', startUrl });
        await deps.enqueueJob(job.id);
        return sendJson(res, 202, { job });
      }

      const jobMatch = url.pathname.match(/^\/v1\/crawl\/jobs\/([0-9a-fA-F-]+)$/);
      if (jobMatch && req.method === 'GET') {
        const job = await deps.repo.getCrawlJob(jobMatch[1]!);
        return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: 'job not found' });
      }

      if (url.pathname === '/v1/ingest' && req.method === 'POST') {
        if (!deps.enqueueIngest) return sendJson(res, 501, { error: 'ingest is not configured' });
        const body = await readJson(req);
        const sourceUrl = typeof body.url === 'string' ? body.url.trim() : '';
        if (!sourceUrl) return sendJson(res, 400, { error: 'url is required' });
        let parsed: URL;
        try { parsed = new URL(sourceUrl); } catch { return sendJson(res, 400, { error: 'invalid url' }); }
        if (!['http:', 'https:'].includes(parsed.protocol)) return sendJson(res, 400, { error: 'only HTTP(S) URLs are allowed' });
        const seed = await deps.repo.findSeedForHost(parsed.hostname.toLowerCase());
        if (!seed?.enabled) return sendJson(res, 400, { error: 'url host is not covered by an enabled seed site' });
        const referrerUrl = typeof body.referrerUrl === 'string' ? body.referrerUrl : null;
        const job = await deps.repo.createCrawlJob({ seedSiteId: seed.id, triggerType: 'discovery', startUrl: sourceUrl });
        await deps.enqueueIngest(job.id, sourceUrl, referrerUrl, seed);
        return sendJson(res, 202, { job });
      }

      if (url.pathname === '/v1/seeds' && req.method === 'GET') return sendJson(res, 200, { seeds: await deps.repo.listSeedSites() });

      if (url.pathname === '/v1/seeds' && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body.name !== 'string' || typeof body.baseUrl !== 'string') return sendJson(res, 400, { error: 'name and baseUrl are required' });
        let baseUrl: URL;
        try { baseUrl = new URL(body.baseUrl); } catch { return sendJson(res, 400, { error: 'invalid baseUrl' }); }
        if (!['http:', 'https:'].includes(baseUrl.protocol)) return sendJson(res, 400, { error: 'only HTTP(S) seed URLs are allowed' });
        const allowedHosts = Array.isArray(body.allowedHosts) ? body.allowedHosts.filter((v): v is string => typeof v === 'string') : [baseUrl.hostname.toLowerCase()];
        if (!allowedHosts.includes(baseUrl.hostname.toLowerCase())) allowedHosts.push(baseUrl.hostname.toLowerCase());
        const seed = await deps.repo.createSeedSite({
          name: body.name, baseUrl: baseUrl.toString(), allowedHosts,
          includePatterns: Array.isArray(body.includePatterns) ? body.includePatterns.filter((v): v is string => typeof v === 'string') : [],
          excludePatterns: Array.isArray(body.excludePatterns) ? body.excludePatterns.filter((v): v is string => typeof v === 'string') : [],
          maxDepth: typeof body.maxDepth === 'number' ? body.maxDepth : 4,
          maxRequestsPerMinute: typeof body.maxRequestsPerMinute === 'number' ? body.maxRequestsPerMinute : 30,
          maxConcurrency: typeof body.maxConcurrency === 'number' ? body.maxConcurrency : 2,
          maxPdfBytes: typeof body.maxPdfBytes === 'number' ? body.maxPdfBytes : 104857600,
        });
        return sendJson(res, 201, { seed });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      return sendJson(res, 500, { error: (error as Error).message });
    }
  });
}
