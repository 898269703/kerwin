export type AppConfig = {
  port: number;
  dataDir: string;
  databaseUrl: string;
  apiToken: string;
  userAgent: string;
  maxPagesPerJob: number;
  maxPdfsPerJob: number;
  defaultMaxPdfBytes: number;
};

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const apiToken = process.env.CRAWLER_API_TOKEN ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!apiToken) throw new Error('CRAWLER_API_TOKEN is required');
  return {
    port: positiveInt('PORT', 3001),
    dataDir: process.env.DATA_DIR ?? '/data',
    databaseUrl,
    apiToken,
    userAgent: process.env.USER_AGENT ?? 'PDF-Finder-Crawler/0.1 (+https://pdf-search-pwa.vercel.app)',
    maxPagesPerJob: positiveInt('MAX_PAGES_PER_JOB', 500),
    maxPdfsPerJob: positiveInt('MAX_PDFS_PER_JOB', 100),
    defaultMaxPdfBytes: positiveInt('MAX_PDF_BYTES', 100 * 1024 * 1024),
  };
}
