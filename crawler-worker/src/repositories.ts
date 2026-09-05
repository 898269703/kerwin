export type QueryResultLike<T = Record<string, unknown>> = { rows: T[] };
export type Queryable = { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResultLike<T>> };

export type DocumentRecord = {
  id: string;
  sha256: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  preferredTitle: string | null;
  preferredFilename: string | null;
  documentNumber: string | null;
};

export type SeedSite = {
  id: string;
  name: string;
  baseUrl: string;
  allowedHosts: string[];
  includePatterns: string[];
  excludePatterns: string[];
  maxDepth: number;
  maxRequestsPerMinute: number;
  maxConcurrency: number;
  maxPdfBytes: number;
  enabled: boolean;
};

export type CrawlJobRecord = {
  id: string;
  seedSiteId: string | null;
  triggerType: 'manual' | 'seed' | 'discovery';
  startUrl: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  pagesFetched: number;
  filesDiscovered: number;
  filesDownloaded: number;
  duplicatesFound: number;
  errorsCount: number;
  errorSummary: string | null;
};

type DocumentRow = {
  id: string;
  sha256: string;
  storage_key: string;
  mime_type?: string;
  byte_size?: string | number;
  preferred_title?: string | null;
  preferred_filename?: string | null;
  document_number?: string | null;
  inserted?: boolean;
};

type SeedRow = {
  id: string; name: string; base_url: string; allowed_hosts: string[]; include_patterns: string[]; exclude_patterns: string[];
  max_depth: number; max_requests_per_minute: number; max_concurrency: number; max_pdf_bytes: string | number; enabled: boolean;
};

type CrawlJobRow = {
  id: string; seed_site_id: string | null; trigger_type: CrawlJobRecord['triggerType']; start_url: string; status: CrawlJobRecord['status'];
  pages_fetched: number; files_discovered: number; files_downloaded: number; duplicates_found: number; errors_count: number; error_summary: string | null;
};

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    sha256: row.sha256,
    storageKey: row.storage_key,
    mimeType: row.mime_type ?? 'application/pdf',
    byteSize: Number(row.byte_size ?? 0),
    preferredTitle: row.preferred_title ?? null,
    preferredFilename: row.preferred_filename ?? null,
    documentNumber: row.document_number ?? null,
  };
}

function mapSeed(row: SeedRow): SeedSite {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    allowedHosts: row.allowed_hosts ?? [],
    includePatterns: row.include_patterns ?? [],
    excludePatterns: row.exclude_patterns ?? [],
    maxDepth: Number(row.max_depth),
    maxRequestsPerMinute: Number(row.max_requests_per_minute),
    maxConcurrency: Number(row.max_concurrency),
    maxPdfBytes: Number(row.max_pdf_bytes),
    enabled: Boolean(row.enabled),
  };
}

function mapJob(row: CrawlJobRow): CrawlJobRecord {
  return {
    id: row.id,
    seedSiteId: row.seed_site_id,
    triggerType: row.trigger_type,
    startUrl: row.start_url,
    status: row.status,
    pagesFetched: Number(row.pages_fetched ?? 0),
    filesDiscovered: Number(row.files_discovered ?? 0),
    filesDownloaded: Number(row.files_downloaded ?? 0),
    duplicatesFound: Number(row.duplicates_found ?? 0),
    errorsCount: Number(row.errors_count ?? 0),
    errorSummary: row.error_summary ?? null,
  };
}

export class DocumentRepository {
  private readonly db: Queryable;
  constructor(db: Queryable) { this.db = db; }

  async createSeedSite(input: {
    name: string; baseUrl: string; allowedHosts: string[]; includePatterns?: string[]; excludePatterns?: string[];
    maxDepth?: number; maxRequestsPerMinute?: number; maxConcurrency?: number; maxPdfBytes?: number;
  }): Promise<SeedSite> {
    const result = await this.db.query<SeedRow>(`
      INSERT INTO seed_sites (name, base_url, allowed_hosts, include_patterns, exclude_patterns, max_depth, max_requests_per_minute, max_concurrency, max_pdf_bytes)
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9)
      RETURNING *
    `, [input.name, input.baseUrl, JSON.stringify(input.allowedHosts), JSON.stringify(input.includePatterns ?? []), JSON.stringify(input.excludePatterns ?? []),
      input.maxDepth ?? 4, input.maxRequestsPerMinute ?? 30, input.maxConcurrency ?? 2, input.maxPdfBytes ?? 104857600]);
    const row = result.rows[0]; if (!row) throw new Error('Seed insert returned no row'); return mapSeed(row);
  }

  async listSeedSites(): Promise<SeedSite[]> {
    const result = await this.db.query<SeedRow>('SELECT * FROM seed_sites ORDER BY created_at ASC');
    return result.rows.map(mapSeed);
  }

  async getSeedSite(id: string): Promise<SeedSite | null> {
    const result = await this.db.query<SeedRow>('SELECT * FROM seed_sites WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? mapSeed(result.rows[0]) : null;
  }

  async findSeedForHost(hostname: string): Promise<SeedSite | null> {
    const result = await this.db.query<SeedRow>(`SELECT * FROM seed_sites WHERE enabled = TRUE AND allowed_hosts ? $1 ORDER BY created_at ASC LIMIT 1`, [hostname.toLowerCase()]);
    return result.rows[0] ? mapSeed(result.rows[0]) : null;
  }

  async createCrawlJob(input: { seedSiteId: string | null; triggerType: CrawlJobRecord['triggerType']; startUrl: string }): Promise<CrawlJobRecord> {
    const result = await this.db.query<CrawlJobRow>(`
      INSERT INTO crawl_jobs (seed_site_id, trigger_type, start_url, status)
      VALUES ($1,$2,$3,'queued') RETURNING *
    `, [input.seedSiteId, input.triggerType, input.startUrl]);
    const row = result.rows[0]; if (!row) throw new Error('Crawl job insert returned no row'); return mapJob(row);
  }

  async getCrawlJob(id: string): Promise<CrawlJobRecord | null> {
    const result = await this.db.query<CrawlJobRow>('SELECT * FROM crawl_jobs WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async updateCrawlJob(id: string, patch: Partial<Pick<CrawlJobRecord, 'status' | 'pagesFetched' | 'filesDiscovered' | 'filesDownloaded' | 'duplicatesFound' | 'errorsCount' | 'errorSummary'>> & { started?: boolean; finished?: boolean }): Promise<void> {
    await this.db.query(`
      UPDATE crawl_jobs SET
        status = COALESCE($2, status), pages_fetched = COALESCE($3, pages_fetched), files_discovered = COALESCE($4, files_discovered),
        files_downloaded = COALESCE($5, files_downloaded), duplicates_found = COALESCE($6, duplicates_found), errors_count = COALESCE($7, errors_count),
        error_summary = COALESCE($8, error_summary), started_at = CASE WHEN $9 THEN COALESCE(started_at, now()) ELSE started_at END,
        finished_at = CASE WHEN $10 THEN now() ELSE finished_at END
      WHERE id = $1
    `, [id, patch.status ?? null, patch.pagesFetched ?? null, patch.filesDiscovered ?? null, patch.filesDownloaded ?? null,
      patch.duplicatesFound ?? null, patch.errorsCount ?? null, patch.errorSummary ?? null, patch.started ?? false, patch.finished ?? false]);
  }

  async recordCrawlPage(input: { jobId: string; url: string; normalizedUrl: string; statusCode: number | null; contentType: string | null; depth: number; pageTitle: string | null; error: string | null }): Promise<void> {
    await this.db.query(`
      INSERT INTO crawl_pages (crawl_job_id, url, normalized_url, status_code, content_type, depth, page_title, error)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (crawl_job_id, normalized_url) DO UPDATE SET status_code=EXCLUDED.status_code, content_type=EXCLUDED.content_type,
        page_title=EXCLUDED.page_title, error=EXCLUDED.error, fetched_at=now()
    `, [input.jobId, input.url, input.normalizedUrl, input.statusCode, input.contentType, input.depth, input.pageTitle, input.error]);
  }

  async upsertDiscoveredLink(input: { url: string; normalizedUrl: string; referrerUrl: string | null; sourceHost: string; anchorText: string | null; likelyDocument: boolean; ingestionStatus: string }): Promise<void> {
    await this.db.query(`
      INSERT INTO discovered_links (url, normalized_url, referrer_url, source_host, anchor_text, likely_document, ingestion_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (normalized_url) DO UPDATE SET url=EXCLUDED.url, referrer_url=COALESCE(EXCLUDED.referrer_url, discovered_links.referrer_url),
        anchor_text=COALESCE(EXCLUDED.anchor_text, discovered_links.anchor_text), likely_document=EXCLUDED.likely_document,
        ingestion_status=CASE WHEN discovered_links.ingestion_status='downloaded' THEN 'downloaded' ELSE EXCLUDED.ingestion_status END, last_seen_at=now()
    `, [input.url, input.normalizedUrl, input.referrerUrl, input.sourceHost, input.anchorText, input.likelyDocument, input.ingestionStatus]);
  }

  async markDiscoveredStatus(normalizedUrl: string, status: 'downloaded' | 'failed' | 'rejected'): Promise<void> {
    await this.db.query('UPDATE discovered_links SET ingestion_status = $2, last_seen_at = now() WHERE normalized_url = $1', [normalizedUrl, status]);
  }

  async upsertDocumentByHash(input: { sha256: string; storageKey: string; mimeType: string; byteSize: number; preferredTitle: string | null; preferredFilename: string | null; documentNumber: string | null }): Promise<{ document: DocumentRecord; duplicate: boolean }> {
    const result = await this.db.query<DocumentRow>(`
      INSERT INTO documents (sha256, storage_key, mime_type, byte_size, preferred_title, preferred_filename, document_number, document_number_normalized)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (sha256) DO UPDATE SET last_seen_at=now(), updated_at=now(),
        preferred_title=COALESCE(documents.preferred_title, EXCLUDED.preferred_title), preferred_filename=COALESCE(documents.preferred_filename, EXCLUDED.preferred_filename),
        document_number=COALESCE(documents.document_number, EXCLUDED.document_number), document_number_normalized=COALESCE(documents.document_number_normalized, EXCLUDED.document_number_normalized)
      RETURNING id, sha256, storage_key, mime_type, byte_size, preferred_title, preferred_filename, document_number, (xmax = 0) AS inserted
    `, [input.sha256, input.storageKey, input.mimeType, input.byteSize, input.preferredTitle, input.preferredFilename, input.documentNumber, input.documentNumber?.replace(/\s+/g, '') ?? null]);
    const row = result.rows[0]; if (!row) throw new Error('Document upsert returned no row');
    return { document: mapDocument(row), duplicate: row.inserted === false };
  }

  async upsertDocumentSource(input: { documentId: string; sourceUrl: string; normalizedSourceUrl: string; sourceHost: string; referrerUrl: string | null; anchorText: string | null; httpFilename: string | null; lastHttpStatus: number | null }): Promise<void> {
    await this.db.query(`
      INSERT INTO document_sources (document_id, source_url, normalized_source_url, source_host, referrer_url, anchor_text, http_filename, last_http_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (document_id, normalized_source_url) DO UPDATE SET source_url=EXCLUDED.source_url,
        referrer_url=COALESCE(EXCLUDED.referrer_url, document_sources.referrer_url), anchor_text=COALESCE(EXCLUDED.anchor_text, document_sources.anchor_text),
        http_filename=COALESCE(EXCLUDED.http_filename, document_sources.http_filename), last_http_status=EXCLUDED.last_http_status, last_seen_at=now()
    `, [input.documentId, input.sourceUrl, input.normalizedSourceUrl, input.sourceHost, input.referrerUrl, input.anchorText, input.httpFilename, input.lastHttpStatus]);
  }

  async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const result = await this.db.query<DocumentRow>('SELECT * FROM documents WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async getDocumentSources(documentId: string): Promise<Array<{ sourceUrl: string; sourceHost: string; anchorText: string | null; firstSeenAt: string; lastSeenAt: string }>> {
    const result = await this.db.query<{ source_url: string; source_host: string; anchor_text: string | null; first_seen_at: string; last_seen_at: string }>(
      'SELECT source_url, source_host, anchor_text, first_seen_at, last_seen_at FROM document_sources WHERE document_id = $1 ORDER BY first_seen_at ASC', [documentId]);
    return result.rows.map((row) => ({ sourceUrl: row.source_url, sourceHost: row.source_host, anchorText: row.anchor_text, firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at) }));
  }

  async searchDocuments(query: string, limit = 20): Promise<Array<DocumentRecord & { score: number; sourceCount: number }>> {
    const normalized = query.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const result = await this.db.query<DocumentRow & { score: string | number; source_count: string | number }>(`
      SELECT d.*,
        GREATEST(CASE WHEN d.document_number_normalized = regexp_replace($1, '\\s+', '', 'g') THEN 1.0 ELSE 0 END,
          similarity(COALESCE(d.preferred_title,''), $1), similarity(COALESCE(d.preferred_filename,''), $1),
          similarity(COALESCE(d.document_number_normalized,''), regexp_replace($1, '\\s+', '', 'g'))) AS score,
        COUNT(ds.id)::int AS source_count
      FROM documents d LEFT JOIN document_sources ds ON ds.document_id = d.id
      WHERE d.document_number_normalized = regexp_replace($1, '\\s+', '', 'g') OR d.preferred_title ILIKE '%' || $1 || '%'
         OR d.preferred_filename ILIKE '%' || $1 || '%' OR similarity(COALESCE(d.preferred_title,''), $1) > 0.2
         OR similarity(COALESCE(d.document_number_normalized,''), regexp_replace($1, '\\s+', '', 'g')) > 0.25
      GROUP BY d.id ORDER BY score DESC, d.last_seen_at DESC LIMIT $2
    `, [normalized, limit]);
    return result.rows.map((row) => ({ ...mapDocument(row), score: Number(row.score), sourceCount: Number(row.source_count) }));
  }
}
