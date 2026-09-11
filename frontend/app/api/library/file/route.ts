const UUID_LIKE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function safeFilename(disposition: string | null): string {
  const match = disposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (!match) return 'document.pdf';
  let value = match[1].trim().replace(/^"|"$/g, '');
  try { value = decodeURIComponent(value); } catch { /* keep raw value */ }
  value = value.replace(/[\r\n\\/"<>:|?*]/g, '_').trim();
  return value || 'document.pdf';
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() || '';
  if (!UUID_LIKE.test(id)) {
    return Response.json({ error: 'valid document id is required' }, { status: 400 });
  }

  const base = process.env.CRAWLER_BASE_URL?.trim().replace(/\/$/, '');
  const token = process.env.CRAWLER_API_TOKEN?.trim();
  if (!base || !token) {
    return Response.json({ error: 'file service unavailable' }, { status: 503 });
  }

  const upstream = await fetch(`${base}/v1/documents/${id}/file`, {
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/pdf',
    },
  });

  if (!upstream.ok) {
    if (upstream.status === 404) {
      return Response.json({ error: 'file not found' }, { status: 404 });
    }
    return Response.json({ error: 'file service unavailable' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf')) {
    return Response.json({ error: 'upstream file is not a PDF' }, { status: 502 });
  }

  const filename = safeFilename(upstream.headers.get('content-disposition'));
  const attachment = url.searchParams.get('download') === '1';
  const bytes = await upstream.arrayBuffer();

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${attachment ? 'attachment' : 'inline'}; filename="${filename}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': attachment ? 'private, max-age=0, must-revalidate' : 'private, max-age=300',
    },
  });
}
