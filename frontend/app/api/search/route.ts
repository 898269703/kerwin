import { runSearch } from '../../../lib/search-orchestrator';

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

  const response = await runSearch(query);
  return Response.json(response, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
