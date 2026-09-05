import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: Resolver = async (hostname) => {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family }));
};

function hostWithoutBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;
}

function inV4Range(ip: string, base: string, prefix: number): boolean {
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & bits) === (ipv4ToInt(base) & bits);
}

function isPublicIpv4(ip: string): boolean {
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, prefix]) => inV4Range(ip, base, prefix));
}

function mappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const match = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match?.[1] ?? null;
}

function isPublicIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = mappedIpv4(lower);
  if (mapped) return isPublicIpv4(mapped);
  if (lower === '::' || lower === '::1') return false;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (lower.startsWith('ff')) return false;
  if (lower.startsWith('2001:db8')) return false;
  return true;
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are allowed');
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  const sorted = [...url.searchParams.entries()].sort(([aKey, aVal], [bKey, bVal]) => aKey.localeCompare(bKey) || aVal.localeCompare(bVal));
  url.search = '';
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return url.toString().replace(/\/$/, (match) => (url.pathname === '/' && !url.search ? match : ''));
}

export async function assertPublicHttpUrl(input: string, allowedHosts?: string[], resolver: Resolver = defaultResolver): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed');
  const hostname = hostWithoutBrackets(url.hostname).toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local hosts are not allowed');
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.map((h) => h.toLowerCase()).includes(hostname)) throw new Error('Host is outside the allowlist');
  const resolved = await resolver(hostname);
  if (resolved.length === 0 || resolved.some((row) => !isPublicIp(row.address))) throw new Error('Host resolves to a non-public address');
  return url;
}
