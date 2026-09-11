import { searchLibrary } from '../../../lib/library';
import { mergeAndRankInitialResults } from '../../../lib/ranking';
import { searchWeb } from '../../../lib/web-search';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON object required' }, { status: 400 });
  }

  const query = typeof body === 'object' && body !== null && 'query' in body
    ? String((body as { query?: unknown }).query ?? '').trim()
    : '';
  if (!query || query.length > 200) {
    return Response.json({ error: 'query is required and must be <= 200 characters' }, { status: 400 });
  }

  const [librarySettled, webSettled] = await Promise.allSettled([
    searchLibrary(query),
    searchWeb(query),
  ]);

  const warnings: string[] = [];
  const libraryResults = librarySettled.status === 'fulfilled' ? librarySettled.value : [];
  const webResults = webSettled.status === 'fulfilled' ? webSettled.value : [];

  if (librarySettled.status === 'rejected') {
    warnings.push('本站文件库暂时不可用，已保留互联网搜索结果。');
  }
  if (webSettled.status === 'rejected') {
    warnings.push('互联网搜索暂时不可用，已保留本站文件库结果。');
  }

  return Response.json({
    query,
    results: mergeAndRankInitialResults(libraryResults, webResults),
    ...(warnings.length ? { warnings } : {}),
  }, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
