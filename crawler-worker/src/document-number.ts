export function extractDocumentNumber(text: string): string | null {
  const normalized = text.normalize('NFKC').replace(/[【\[]/g, '〔').replace(/[】\]]/g, '〕').replace(/\s+/g, '');
  const match = normalized.match(/([\u4e00-\u9fffA-Za-z]{1,24})〔(19\d{2}|20\d{2})〕(\d{1,6})号/);
  if (!match) return null;
  const prefix = match[1].replace(/^(关于印发|关于发布|关于|印发|发布)/, '');
  return `${prefix}〔${match[2]}〕${match[3]}号`;
}
