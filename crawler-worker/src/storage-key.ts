export function storageKeyForSha256(sha256: string): string {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Invalid SHA256');
  const sha = sha256.toLowerCase();
  return `pdfs/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.pdf`;
}
