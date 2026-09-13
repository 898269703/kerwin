import { crawlerConfig } from '../../../../lib/crawler-client';

const UUID_LIKE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function safeFilename(disposition: string | null): string {
  const extended = disposition?.match(/(?:^|;)\s*filename\*=UTF-8'[^']*'([^;]+)/i);
  const match = extended ?? disposition?.match(/(?:^|;)\s*filename="?([^";]+)/i);
  if (!match) return 'document.pdf';
  let value = match[1].trim().replace(/^"|"$/g, '');
  if (extended) {
    try { value = decodeURIComponent(value); } catch { /* keep raw value */ }
  }
  value = value.replace(/[\x00-\x1f\x7f\\/"<>:|?*]/g, '_').trim();
  return value || 'document.pdf';
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() || '';
  if (!UUID_LIKE.test(id)) {
    return Response.json({ error: 'valid document id is required' }, { status: 400 });
  }

  let config: ReturnType<typeof crawlerConfig>;
  try {
    config = crawlerConfig();
  } catch {
    return Response.json({ error: 'file service unavailable' }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.base}/v1/documents/${id}/file`, {
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/pdf',
      },
    });
  } catch {
    return Response.json({ error: 'file service unavailable' }, { status: 502 });
  }

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
  const asciiFilename = /^[\x20-\x7e]+$/.test(filename) ? filename : 'document.pdf';
  const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const attachment = url.searchParams.get('download') === '1';
  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch {
    return Response.json({ error: 'file service unavailable' }, { status: 502 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${attachment ? 'attachment' : 'inline'}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      'x-content-type-options': 'nosniff',
      'cache-control': attachment ? 'private, max-age=0, must-revalidate' : 'private, max-age=300',
    },
  });
}
