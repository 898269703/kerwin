export type LinkKind = 'document' | 'page' | 'ignore';
export type LinkClassification = { kind: LinkKind; reason: string };

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if ('\\.^$+?()[]{}|'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  out += '$';
  return new RegExp(out);
}

export function isAllowedPath(pathname: string, excludePatterns: string[] = [], includePatterns: string[] = []): boolean {
  if (excludePatterns.some((p) => globToRegExp(p).test(pathname))) return false;
  if (includePatterns.length > 0 && !includePatterns.some((p) => globToRegExp(p).test(pathname))) return false;
  return true;
}

export function classifyLink(input: { url: string; anchorText?: string | null; downloadAttribute?: string | null }): LinkClassification {
  let url: URL;
  try { url = new URL(input.url); } catch { return { kind: 'ignore', reason: 'invalid-url' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { kind: 'ignore', reason: 'unsupported-scheme' };

  const path = decodeURIComponent(url.pathname).toLowerCase();
  const anchor = (input.anchorText ?? '').toLowerCase();
  const download = (input.downloadAttribute ?? '').toLowerCase();
  if (/\.pdf$/i.test(path)) return { kind: 'document', reason: 'pdf-extension' };
  if (/\.pdf(?:$|[?#])/i.test(url.toString())) return { kind: 'document', reason: 'pdf-url-signal' };

  const endpointSignal = /\/(download|attachment|attachments|upload|uploads|file|files)(?:\/|$)/i.test(path)
    || /(?:^|[?&])(file|filename|attachment|download|id)=/i.test(url.search);
  const textSignal = /(pdf|附件|下载|文件|全文|原文)/i.test(`${anchor} ${download}`);
  if ((endpointSignal && textSignal) || /\.pdf$/i.test(download)) return { kind: 'document', reason: 'download-signal' };

  if (/\.(zip|rar|7z|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|mp4|mp3)$/i.test(path)) return { kind: 'ignore', reason: 'non-html-asset' };
  return { kind: 'page', reason: 'html-candidate' };
}
