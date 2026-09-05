import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicHttpUrl } from './url-policy.ts';

export type DownloadedPdf = {
  sourceUrl: string;
  finalUrl: string;
  tempPath: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  httpFilename: string | null;
  statusCode: number;
};

export type DownloadPdfInput = {
  url: string;
  tempDir: string;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedHosts?: string[];
  assertUrl?: (url: string) => Promise<URL>;
  fetchImpl?: typeof fetch;
};

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, '')); } catch { return utf8[1].trim(); }
  }
  const plain = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return (plain?.[1] ?? plain?.[2] ?? '').trim() || null;
}

function allowedPdfContentType(contentType: string): boolean {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return ['application/pdf', 'application/x-pdf', 'application/acrobat', 'application/octet-stream'].includes(type);
}

export async function downloadPdf(input: DownloadPdfInput): Promise<DownloadedPdf> {
  const assertUrl = input.assertUrl ?? ((url: string) => assertPublicHttpUrl(url, input.allowedHosts));
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxRedirects = input.maxRedirects ?? 3;
  await mkdir(input.tempDir, { recursive: true });

  let current = input.url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const safeUrl = await assertUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(safeUrl, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'PDF-Finder-Crawler/0.1' } });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error(`Redirect ${response.status} missing Location header`);
      if (redirectCount >= maxRedirects) throw new Error('Too many redirects');
      current = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`PDF request failed with HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!allowedPdfContentType(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Response is not a PDF content type: ${contentType || 'unknown'}`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > input.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`PDF is too large: ${declaredLength} bytes`);
    }
    if (!response.body) throw new Error('PDF response has no body');

    const tempPath = join(input.tempDir, `${randomUUID()}.part`);
    const file = await open(tempPath, 'wx');
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    let byteSize = 0;
    let prefix = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        byteSize += chunk.length;
        if (byteSize > input.maxBytes) throw new Error(`PDF is too large: streamed beyond ${input.maxBytes} bytes`);
        if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, Math.max(0, 5 - prefix.length))]);
        hash.update(chunk);
        await file.write(chunk);
      }
      if (prefix.subarray(0, 5).toString() !== '%PDF-') throw new Error('Response body does not have a PDF signature');
      await file.sync();
      await file.close();
      return {
        sourceUrl: input.url,
        finalUrl: safeUrl.toString(),
        tempPath,
        sha256: hash.digest('hex'),
        byteSize,
        contentType: contentType || 'application/pdf',
        httpFilename: parseFilename(response.headers.get('content-disposition')),
        statusCode: response.status,
      };
    } catch (error) {
      try { await reader.cancel(); } catch {}
      try { await file.close(); } catch {}
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('Unreachable redirect state');
}
