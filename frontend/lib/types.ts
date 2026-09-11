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

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  warnings?: string[];
}
