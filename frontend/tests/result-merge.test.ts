import { expect, test } from 'vitest';
import { mergePostCrawlResults } from '../lib/result-merge';
import type { SearchResult } from '../lib/types';

const library156: SearchResult = {
  origin: 'library',
  sourceClass: 'library',
  verified: true,
  score: 99,
  title: '国家电网财〔2014〕156号',
  source: '本站文件库',
  snippet: '156.pdf',
  reasons: ['本站已收录'],
  contentLength: 1024,
  libraryId: '51957b6f-1111-2222-3333-444444444444',
};

const web156: SearchResult = {
  origin: 'web',
  sourceClass: 'official',
  verified: true,
  score: 94,
  title: '国家电网财〔2014〕156号',
  source: 'example.gov',
  snippet: '公开网页',
  reasons: ['官方来源'],
  contentLength: 10,
  url: 'https://example.gov/156.html',
  finalUrl: 'https://example.gov/156.html',
};

const unrelatedWeb: SearchResult = {
  ...web156,
  score: 70,
  title: '其他技经文件',
  url: 'https://example.gov/other.html',
  finalUrl: 'https://example.gov/other.html',
};

test('new library result replaces matching web result and moves first', () => {
  const merged = mergePostCrawlResults([library156], [web156, unrelatedWeb]);
  expect(merged[0]).toEqual(library156);
  expect(merged.filter((result) => result.title.includes('156号'))).toHaveLength(1);
  expect(merged).toContainEqual(unrelatedWeb);
});

test('deduplicates identical library ids', () => {
  const olderLibrary = { ...library156, score: 80 };
  const merged = mergePostCrawlResults([library156], [olderLibrary, unrelatedWeb]);
  expect(merged.filter((result) => result.libraryId === library156.libraryId)).toHaveLength(1);
  expect(merged[0].score).toBe(99);
});
