export type SearchOrigin = 'library' | 'web';
export type SourceClass = 'official' | 'institutional' | 'public' | 'other' | 'library';

export interface SearchResult {
  origin: SearchOrigin;
  sourceClass: SourceClass;
  verified: boolean;
  score: number;
  title: string;
  source: string;
  snippet: string;
  reasons: string[];
  contentLength: number;
  url?: string;
  finalUrl?: string;
  libraryId?: string;
}

export type CrawlJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
export type CrawlState = 'not_needed' | 'started' | 'running' | 'complete' | 'unavailable';

export interface CrawlJob {
  id: string;
  startUrl: string;
  status: CrawlJobStatus;
  pagesFetched: number;
  filesDiscovered: number;
  filesDownloaded: number;
  duplicatesFound: number;
  errorsCount: number;
  errorSummary?: string | null;
  reused?: boolean;
}

export interface CrawlInfo {
  state: CrawlState;
  jobs: CrawlJob[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  warnings?: string[];
  crawl?: CrawlInfo;
}
