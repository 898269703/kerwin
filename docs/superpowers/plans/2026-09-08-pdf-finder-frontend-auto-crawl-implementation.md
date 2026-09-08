# PDF Finder Frontend Auto-Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the currently deployed PDF Finder PWA as repository-owned Next.js source, then add server-side Scrapling orchestration and a non-blocking crawl-progress UI that refreshes newly ingested library PDFs after a search miss.

**Architecture:** `frontend/` becomes the source of truth for the current Vercel UI and APIs. `/api/search` keeps the current local-library-first + web-search response contract and adds optional `crawl` metadata only when the library has zero results; `/api/search/status` polls Railway server-side with the secret token and refreshes the local library when jobs terminate. The browser never calls Railway directly and never receives crawler credentials.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, Vitest, Testing Library, Playwright, Vercel, existing Railway Scrapling worker, SearXNG, public Scrapling library endpoints.

**Spec:** `docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md`

**Backend prerequisite:** `docs/superpowers/plans/2026-09-08-search-discovery-worker-implementation.md` Tasks 1–5 must be complete and production-smoke verified before enabling automatic crawl in Vercel Preview.

## Global Constraints

- Production `pdf-search-pwa.vercel.app` remains untouched until Preview acceptance passes.
- Preserve current visible copy, result labels, result ranking semantics, PWA manifest behavior, `/api/search`, and `/api/library/file` behavior before adding crawl UI.
- Local-library hit means no automatic crawl job.
- Zero local-library results may enqueue at most 3 server-selected candidates.
- Web search results return immediately; crawling must not block initial response.
- Crawler failure must not erase valid library/web results or turn the search into HTTP 500.
- `CRAWLER_BASE_URL` and `CRAWLER_API_TOKEN` are server-only and must never use `NEXT_PUBLIC_`.
- Browser polls only `/api/search/status`; status polling must never enqueue another crawl.
- Initial polling: 2 seconds; after 30 seconds: 4 seconds; client-side stop at 150 seconds or terminal jobs.
- New library results replace matching web candidates and are promoted above web results.
- No OCR, embeddings, RAG, broad redesign, or permanent Seed creation in this phase.

---

## File Structure

**Create repository frontend**
- `frontend/package.json` — build/test scripts and pinned framework baseline.
- `frontend/tsconfig.json` — strict TypeScript config.
- `frontend/next.config.ts` — minimal Next config.
- `frontend/app/layout.tsx` — metadata and root layout.
- `frontend/app/page.tsx` — existing search UI + crawl-progress state.
- `frontend/app/globals.css` — production-parity visual styles.
- `frontend/app/manifest.ts` — PWA manifest.
- `frontend/app/api/search/route.ts` — public search orchestration.
- `frontend/app/api/search/status/route.ts` — crawler job polling + library refresh.
- `frontend/app/api/library/file/route.ts` — current file proxy/download behavior.
- `frontend/lib/types.ts` — shared response/result/crawl types.
- `frontend/lib/library.ts` — Scrapling public/private library client.
- `frontend/lib/web-search.ts` — existing SearXNG discovery adapter.
- `frontend/lib/ranking.ts` — result scoring/merge helpers.
- `frontend/lib/crawler-client.ts` — server-only Railway client.
- `frontend/lib/search-orchestrator.ts` — local-first decision + candidate selection.
- `frontend/lib/result-merge.ts` — post-crawl library/web dedupe.
- `frontend/tests/` — Vitest unit/route/UI tests.
- `frontend/e2e/search.spec.ts` — Playwright Preview acceptance.
- `.github/workflows/frontend-ci.yml` — frontend test/build gate.

**Do not modify production alias until Task 7 acceptance is complete.**

---

### Task 1: Recreate repository-owned frontend baseline with parity tests

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/manifest.ts`
- Create: `frontend/lib/types.ts`
- Create: `frontend/tests/page-parity.test.tsx`

**Interfaces:**
- Produces `SearchResult` with current fields: `origin`, `sourceClass`, `verified`, `score`, `title`, `source`, `snippet`, `reasons`, `contentLength`, `url`, `finalUrl`, `libraryId`.
- Produces `SearchResponse` with `results`, optional `warnings`, and later optional `crawl` metadata.

- [ ] **Step 1: Create the frontend package and exact scripts**

Use:

```json
{
  "name": "pdf-search-pwa",
  "version": "0.3.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "test": "vitest run",
    "build": "vitest run && next build",
    "start": "next start",
    "e2e": "playwright test"
  },
  "dependencies": {
    "next": "16.3.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Write RED parity test for production copy and controls**

```tsx
import { render, screen } from '@testing-library/react';
import Page from '../app/page';

test('renders the verified production search shell', () => {
  render(<Page />);
  expect(screen.getByText('PDF Finder')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '找到你真正需要的 PDF' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('例如：国家电网财〔2014〕156号')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
  expect(screen.getByText('自有库优先 · 文号强匹配 · 官方来源优先')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run parity test RED**

```bash
cd frontend
npm install
npm test -- page-parity.test.tsx
```

Expected: FAIL because app source does not exist yet.

- [ ] **Step 4: Implement layout metadata and baseline page**

`app/layout.tsx` metadata must match production:

```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PDF Finder',
  description: '搜索、抓取并下载公开来源中的 PDF 文件',
  applicationName: 'PDF Finder',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
```

`app/page.tsx` must preserve the verified production text and examples:

```tsx
const examples = [
  '国家电网财〔2014〕156号',
  '输变电工程 全生命周期 碳排放 核算',
  '电力建设工程 预算定额',
];
```

Use the current header/hero/results structure and CSS class names already observed in production: `brand`, `logo`, `hint`, `hero`, `inner`, `examples`, `results`, `summary`, `card`, `top`, `topmark`, `meta`, `badge`, `verified`, `muted`, `source`, `reasons`, `actions`, `primary`, `alert`, `error`, `warn`, `empty`.

- [ ] **Step 5: Implement PWA manifest**

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PDF Finder',
    short_name: 'PDF Finder',
    description: '搜索、抓取并下载公开来源中的 PDF 文件',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  };
}
```

- [ ] **Step 6: Run parity test and build GREEN**

```bash
cd frontend
npm test
npm run build
```

Expected routes at this stage: `/`, `/_not-found`, `/manifest.webmanifest`.

- [ ] **Step 7: Commit Task 1**

```bash
git add frontend
git commit -m "feat(frontend): recreate pdf finder production shell"
```

---

### Task 2: Recreate existing library and web-search behavior before auto-crawl

**Files:**
- Create: `frontend/lib/library.ts`
- Create: `frontend/lib/web-search.ts`
- Create: `frontend/lib/ranking.ts`
- Create: `frontend/app/api/library/file/route.ts`
- Create: `frontend/app/api/search/route.ts`
- Create: `frontend/tests/library.test.ts`
- Create: `frontend/tests/web-search.test.ts`
- Create: `frontend/tests/search-route-parity.test.ts`

**Interfaces:**
- `searchLibrary(query: string): Promise<SearchResult[]>`
- `searchWeb(query: string): Promise<SearchResult[]>`
- `mergeAndRankInitialResults(library, web): SearchResult[]`
- `POST /api/search` returns the existing result structure before crawl metadata is enabled.

- [ ] **Step 1: Write RED library adapter test**

Mock `fetch` and require the current Scrapling public endpoint shape:

```ts
import { expect, test, vi } from 'vitest';
import { searchLibrary } from '../lib/library';

test('maps public library results into UI results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: '156号',
    results: [{
      origin: 'library',
      id: 'doc-1',
      title: '国家电网财〔2014〕156号',
      filename: '156.pdf',
      byteSize: 1234,
      score: 0.93,
      downloadPath: '/public/file?id=doc-1'
    }]
  }), { status: 200 })));
  const rows = await searchLibrary('156号');
  expect(rows[0].origin).toBe('library');
  expect(rows[0].libraryId).toBe('doc-1');
  expect(rows[0].verified).toBe(true);
});
```

- [ ] **Step 2: Write RED web-search/ranking tests**

Require official/institutional/public source classes and preserve current score range 0–100. At minimum:

```ts
test('official PDF candidate ranks above generic page with similar text', async () => {
  const results = rankWebCandidates('预算定额', [officialPdf, genericPage]);
  expect(results[0].sourceClass).toBe('official');
  expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
});
```

- [ ] **Step 3: Implement library client**

Use a server-side base URL:

```ts
const libraryBase = process.env.CRAWLER_PUBLIC_BASE_URL ?? process.env.CRAWLER_BASE_URL;
```

`searchLibrary()` calls:

```text
GET {base}/public/search?q=<encoded>&limit=20
```

For library download cards, map the result to local Vercel `/api/library/file?id=<libraryId>` rather than exposing an internal Railway hostname.

- [ ] **Step 4: Implement `/api/library/file` proxy**

Validate `id` as UUID-like input, fetch server-side from:

```text
GET {CRAWLER_BASE_URL}/v1/documents/{id}/file
Authorization: Bearer {CRAWLER_API_TOKEN}
```

Stream/return PDF bytes with `content-type: application/pdf`, `x-content-type-options: nosniff`, and attachment/inline disposition based on `download=1`.

Do not return the bearer token in any response header/body.

- [ ] **Step 5: Implement current web discovery adapter and `/api/search` parity**

`searchWeb()` must use the existing SearXNG environment/config path and normalize candidates into `SearchResult`.

Initial route behavior:

```ts
const query = body.query.trim();
const [libraryResults, webResults] = await Promise.all([
  searchLibrary(query),
  searchWeb(query),
]);
return Response.json({
  query,
  results: mergeAndRankInitialResults(libraryResults, webResults),
  warnings,
});
```

If SearXNG fails but library succeeds, return library results plus warning rather than HTTP 500.

- [ ] **Step 6: Run parity tests/build GREEN**

```bash
cd frontend
npm test
npm run build
```

Expected routes now include `/api/search` and `/api/library/file` matching the verified production route set.

- [ ] **Step 7: Commit Task 2**

```bash
git add frontend/lib/library.ts frontend/lib/web-search.ts frontend/lib/ranking.ts \
        frontend/app/api/library/file/route.ts frontend/app/api/search/route.ts \
        frontend/tests
git commit -m "feat(frontend): restore library and web search behavior"
```

---

### Task 3: Add server-only crawler client and zero-library orchestration

**Files:**
- Create: `frontend/lib/crawler-client.ts`
- Create: `frontend/lib/search-orchestrator.ts`
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/app/api/search/route.ts`
- Create: `frontend/tests/crawler-client.test.ts`
- Create: `frontend/tests/search-orchestrator.test.ts`

**Interfaces:**
- `enqueueSearchDiscovery(url: string, query: string): Promise<CrawlJob>`
- `getCrawlJob(id: string): Promise<CrawlJob>`
- `runSearch(query: string): Promise<SearchResponse>`
- `SearchResponse.crawl?: { state, jobs, retryAfterMs }`

- [ ] **Step 1: Define exact crawl types**

```ts
export type CrawlJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export interface CrawlJob {
  id: string;
  startUrl: string;
  status: CrawlJobStatus;
  pagesFetched: number;
  filesDiscovered: number;
  filesDownloaded: number;
  duplicatesFound: number;
  errorsCount: number;
  reused?: boolean;
}

export type CrawlState = 'not_needed' | 'started' | 'running' | 'complete' | 'unavailable';
```

- [ ] **Step 2: Write RED crawler-client secret test**

```ts
test('adds bearer token only to server-side Railway request', async () => {
  process.env.CRAWLER_BASE_URL = 'https://crawler.example';
  process.env.CRAWLER_API_TOKEN = 'server-secret';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: fakeJob }), { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  await enqueueSearchDiscovery('https://example.gov/a', '156号');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://crawler.example/v1/search-discovery/jobs',
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer server-secret' })
    })
  );
});
```

- [ ] **Step 3: Write RED orchestrator tests for trigger rules**

Required cases:

```ts
test('does not crawl when library has any result', async () => {
  const response = await runSearchWithDeps('156号', depsWithLibraryHit);
  expect(response.crawl?.state).toBe('not_needed');
  expect(depsWithLibraryHit.enqueue).not.toHaveBeenCalled();
});

test('enqueues at most three candidates when library is empty', async () => {
  const response = await runSearchWithDeps('预算定额', depsWithFiveWebCandidates);
  expect(depsWithFiveWebCandidates.enqueue).toHaveBeenCalledTimes(3);
  expect(response.crawl?.state).toBe('started');
});

test('crawler failure preserves web results', async () => {
  const response = await runSearchWithDeps('预算定额', depsWithCrawlerFailure);
  expect(response.results.length).toBeGreaterThan(0);
  expect(response.crawl?.state).toBe('unavailable');
});
```

- [ ] **Step 4: Implement candidate selection**

Select at most 3 unique candidate URLs in this order:
1. verified direct PDF;
2. `sourceClass === 'official'` or `'institutional'` attachment/document page;
3. remaining high-confidence HTTP(S) public page.

Reject candidates with non-HTTP(S), embedded credentials, or obvious login/cart/upload/admin path indicators before calling Railway. Scrapling remains authoritative for network/redirect safety.

- [ ] **Step 5: Implement orchestrator and extend `/api/search`**

Pseudo-code must match this exact control flow:

```ts
const libraryResults = await searchLibrary(query);
const webResults = await searchWeb(query);
const results = mergeAndRankInitialResults(libraryResults, webResults);

if (libraryResults.length > 0) {
  return { query, results, warnings, crawl: { state: 'not_needed', jobs: [], retryAfterMs: 0 } };
}

const candidates = selectCrawlCandidates(webResults).slice(0, 3);
if (candidates.length === 0) {
  return { query, results, warnings, crawl: { state: 'unavailable', jobs: [], retryAfterMs: 0 } };
}

const settled = await Promise.allSettled(
  candidates.map(candidate => enqueueSearchDiscovery(candidate.url, query))
);
const jobs = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
return {
  query,
  results,
  warnings: jobs.length ? warnings : [...warnings, '深度查找暂时不可用，已保留当前互联网搜索结果。'],
  crawl: jobs.length
    ? { state: 'started', jobs, retryAfterMs: 2000 }
    : { state: 'unavailable', jobs: [], retryAfterMs: 0 }
};
```

- [ ] **Step 6: Run focused/full tests GREEN**

```bash
cd frontend
npm test -- crawler-client.test.ts search-orchestrator.test.ts
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add frontend/lib frontend/app/api/search/route.ts frontend/tests
git commit -m "feat(frontend): trigger bounded crawl on library miss"
```

---

### Task 4: Add `/api/search/status` polling route and post-crawl merge

**Files:**
- Create: `frontend/lib/result-merge.ts`
- Create: `frontend/app/api/search/status/route.ts`
- Create: `frontend/tests/search-status-route.test.ts`
- Create: `frontend/tests/result-merge.test.ts`

**Interfaces:**
- `mergePostCrawlResults(library: SearchResult[], existing: SearchResult[]): SearchResult[]`
- `GET /api/search/status?q=<encoded>&jobId=<id>&jobId=<id>`

- [ ] **Step 1: Write RED result-merge tests**

```ts
test('new library result replaces matching web result and moves first', () => {
  const merged = mergePostCrawlResults([library156], [web156, unrelatedWeb]);
  expect(merged[0].origin).toBe('library');
  expect(merged.filter(r => r.title.includes('156号'))).toHaveLength(1);
});
```

Deduplication order must be: same library ID, same canonical final/source URL, then high-confidence normalized title/document number.

- [ ] **Step 2: Write RED status-route tests**

Required cases:
- zero `jobId` => 400;
- invalid/too many job IDs (>3) => 400;
- any queued/running => state `running`, no library refresh required;
- all terminal => call `searchLibrary(q)` and return `libraryResults`;
- failed Railway status request => response still serializes remaining jobs and never exposes token.

- [ ] **Step 3: Implement status route**

```ts
const ids = searchParams.getAll('jobId').slice(0, 3);
const jobs = await Promise.all(ids.map(getCrawlJob));
const terminal = jobs.every(job => ['succeeded', 'partial', 'failed'].includes(job.status));
const libraryResults = terminal ? await searchLibrary(query) : [];
const state = terminal ? 'complete' : 'running';
return Response.json({ state, jobs, libraryResults });
```

Do not call `enqueueSearchDiscovery()` anywhere in this route.

- [ ] **Step 4: Run route/merge/full tests GREEN**

```bash
cd frontend
npm test -- search-status-route.test.ts result-merge.test.ts
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend/lib/result-merge.ts \
        frontend/app/api/search/status/route.ts \
        frontend/tests/search-status-route.test.ts \
        frontend/tests/result-merge.test.ts
git commit -m "feat(frontend): poll crawl jobs and refresh library"
```

---

### Task 5: Add non-blocking crawl-progress UI state machine

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/globals.css`
- Create: `frontend/tests/crawl-progress-ui.test.tsx`

**Interfaces:**
- Browser consumes only `POST /api/search` and `GET /api/search/status`.
- Progress panel accepts current jobs and renders aggregate pages/PDF counts.
- Poller stops on terminal result or after 150 seconds.

- [ ] **Step 1: Write RED UI tests**

Use fake timers and mocked fetch:

```tsx
test('shows web results immediately while crawl is queued', async () => {
  // POST /api/search returns one web result + crawl.state='started'
  render(<Page />);
  // submit query
  expect(await screen.findByText('正在准备深度查找…')).toBeInTheDocument();
  expect(screen.getByText('互联网候选标题')).toBeInTheDocument();
});


test('updates crawl counters and promotes returned library result', async () => {
  // first status: running pages=8 filesDiscovered=2
  // terminal status: complete with libraryResults=[library156]
  expect(await screen.findByText('正在抓取公开来源：已检查 8 个页面，发现 2 个 PDF')).toBeInTheDocument();
  expect(await screen.findByText('已找到并收录新的 PDF，可直接从本站下载。')).toBeInTheDocument();
});
```

Also test no polling when `crawl.state='not_needed'`, polling stops terminally, and an unavailable crawl keeps web cards visible.

- [ ] **Step 2: Implement search/crawl client state**

Maintain state for:

```ts
const [query, setQuery] = useState('');
const [data, setData] = useState<SearchResponse | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState('');
const [crawlView, setCrawlView] = useState<CrawlView | null>(null);
```

After initial `/api/search`, call `startPolling()` only when `crawl.state === 'started'` and job IDs exist.

- [ ] **Step 3: Implement bounded polling schedule**

Exact policy:
- elapsed <30s => 2000ms;
- elapsed >=30s => 4000ms;
- elapsed >=150s => stop with non-fatal no-hit/unavailable copy;
- terminal status => stop immediately;
- hidden tab may use 8000ms; on `visibilitychange` to visible, schedule the next poll promptly.

Use an `AbortController` per search so submitting a new query cancels the previous poll loop.

- [ ] **Step 4: Implement progress copy and post-crawl result replacement**

Render one panel above results:

```text
queued  -> 正在准备深度查找…
running -> 正在抓取公开来源：已检查 {pages} 个页面，发现 {pdfs} 个 PDF
hit     -> 已找到并收录新的 PDF，可直接从本站下载。
no hit  -> 深度查找已完成，暂未发现新的可下载 PDF。
unavail -> 深度查找暂时不可用，已保留当前互联网搜索结果。
```

When terminal `libraryResults.length > 0`, call `mergePostCrawlResults()` and update `data.results` without issuing another crawl-capable search request.

- [ ] **Step 5: Run UI/full build GREEN**

```bash
cd frontend
npm test -- crawl-progress-ui.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add frontend/app/page.tsx frontend/app/globals.css frontend/tests/crawl-progress-ui.test.tsx
git commit -m "feat(frontend): show live deep-search progress"
```

---

### Task 6: Add frontend CI and Vercel Preview deployment

**Files:**
- Create: `.github/workflows/frontend-ci.yml`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/search.spec.ts`

**Interfaces:**
- CI runs from repository `frontend/` root.
- Preview receives server-only environment variables for crawler/library/SearXNG.
- Production alias remains untouched.

- [ ] **Step 1: Add GitHub Actions build gate**

Workflow must trigger on `crawler-mvp` changes to `frontend/**` and run:

```yaml
- run: npm ci
  working-directory: frontend
- run: npm test
  working-directory: frontend
- run: npm run build
  working-directory: frontend
```

Use Node 24 to match the current Vercel project baseline.

- [ ] **Step 2: Add Playwright Preview smoke**

`e2e/search.spec.ts` must cover:

```ts
test('search page loads and can submit a query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '找到你真正需要的 PDF' })).toBeVisible();
  await page.getByPlaceholder('例如：国家电网财〔2014〕156号').fill('国家电网财〔2014〕156号');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.locator('.results')).toBeVisible();
});
```

- [ ] **Step 3: Verify CI GREEN**

Expected frontend workflow result:

```text
npm ci: PASS
vitest: PASS
next build: PASS
```

- [ ] **Step 4: Deploy repository frontend to Vercel Preview only**

Set Preview server-only environment variables:

```text
CRAWLER_BASE_URL=<Railway public/private reachable HTTPS worker URL>
CRAWLER_API_TOKEN=<existing secret>
CRAWLER_PUBLIC_BASE_URL=<public worker base if distinct>
SEARXNG_BASE_URL=<existing discovery service URL>
```

No variable containing secrets may be prefixed `NEXT_PUBLIC_`.

- [ ] **Step 5: Verify Preview route set**

Expected build output contains:

```text
○ /
ƒ /api/search
ƒ /api/search/status
ƒ /api/library/file
○ /manifest.webmanifest
```

- [ ] **Step 6: Commit Task 6**

```bash
git add .github/workflows/frontend-ci.yml frontend/playwright.config.ts frontend/e2e/search.spec.ts
git commit -m "ci(frontend): add pdf finder preview gates"
```

---

### Task 7: Preview end-to-end acceptance and production cutover gate

**Files:**
- Modify after evidence only: `docs/superpowers/specs/2026-09-08-search-miss-auto-crawl-design.md` status line if desired.
- Add/update: `frontend/DEPLOYMENT_STATUS.md` with exact Preview evidence.

**Interfaces:**
- Test local library hit path.
- Test zero-library auto-crawl path with deterministic W3C candidate.
- Test crawler-unavailable fallback.
- Production cutover is allowed only after all acceptance criteria pass.

- [ ] **Step 1: Verify known library hit does not create crawl**

Search a query already present in the library. Acceptance:
- library card appears;
- no crawl progress panel;
- response `crawl.state='not_needed'`;
- Railway logs show no new search-discovery job for that request.

- [ ] **Step 2: Verify W3C zero-library deep-search path**

Use a deterministic test query/candidate path wired through the Preview test environment so initial library search is empty but web discovery returns `https://www.w3.org/TR/REC-html40-971218/`.

Acceptance:
- web candidate appears immediately;
- progress shows real page counters;
- Scrapling job uses `seedSiteId=null`;
- PDF discovery/download or dedupe occurs;
- terminal status refreshes library results;
- resulting library card is promoted above web candidates;
- direct `/api/library/file?id=...&download=1` returns PDF bytes.

- [ ] **Step 3: Verify repeated search reuses active/recent job**

Repeat while running and within 30 minutes after success. Acceptance:
- same job ID reused;
- no duplicate crawl storm;
- UI polling still terminates normally.

- [ ] **Step 4: Verify crawler-unavailable fallback**

In Preview only, temporarily point crawler base to a controlled unreachable endpoint or use a test injection. Acceptance:
- `/api/search` still returns web results;
- `crawl.state='unavailable'`;
- warning is visible;
- no browser-visible secret or stack trace.

- [ ] **Step 5: Security inspection**

Inspect browser network/source and ensure no occurrence of:

```text
CRAWLER_API_TOKEN
Bearer <crawler secret>
railway.internal
```

Internal Railway hostnames may appear only in server logs, never browser responses.

- [ ] **Step 6: Record Preview evidence**

Create `frontend/DEPLOYMENT_STATUS.md` with:
- commit SHA;
- Preview deployment ID/URL;
- test query;
- Worker job IDs;
- pages/PDF counters;
- cooldown reuse result;
- crawler-unavailable fallback result;
- `/api/library/file` verification;
- known remaining warnings.

- [ ] **Step 7: Production cutover only if every gate is GREEN**

After Preview passes, connect the repository-backed `frontend/` project to Vercel or deploy the exact accepted commit to the existing `pdf-search-pwa` production project. Promote the accepted deployment to the production alias.

Keep the previous READY deployment `dpl_HC2uzWdctFD14AcXvgyvBF3bRECF` available as immediate rollback candidate during observation unless Vercel supersedes the identifier during project migration.

- [ ] **Step 8: Verify production after cutover**

Acceptance:
- `/` returns 200;
- known library query works;
- web-search fallback works;
- zero-library search can start bounded crawl;
- status polling completes;
- newly ingested PDF downloads;
- no new runtime error cluster appears in Vercel;
- Railway worker remains healthy.

- [ ] **Step 9: Commit deployment evidence**

```bash
git add frontend/DEPLOYMENT_STATUS.md
git commit -m "docs(frontend): record auto crawl acceptance"
```

---

## Plan Self-Review Result

- Spec coverage: frontend source-of-truth migration, search response extension, candidate selection, server-only crawler client, polling route, state machine, result merge, failure behavior, observability, tests, Preview gate, rollback, and production cutover are mapped to Tasks 1–7.
- Backend-specific SSRF/cooldown/job execution is intentionally delegated to the prerequisite worker implementation plan rather than duplicated here.
- No task requires changing the existing production alias before Preview acceptance.
- `CRAWLER_API_TOKEN` is server-only in every task and test.
- Auto-crawl trigger is consistently `libraryResults.length === 0`; no weak-hit heuristic is introduced.
- Maximum auto-crawl candidates is consistently 3.
- Polling cadence is consistently 2s → 4s after 30s → stop at 150s.
- `/api/search/status` never enqueues jobs.
- New library documents replace matching web candidates rather than duplicating cards.
- Existing production copy and route parity are established before crawl UI is added.
