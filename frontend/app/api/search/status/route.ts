import { getCrawlJob } from '../../../../lib/crawler-client';
import { searchLibrary } from '../../../../lib/library';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TERMINAL = new Set(['succeeded', 'partial', 'failed']);

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const ids = url.searchParams.getAll('jobId');

  if (!query || query.length > 200) {
    return Response.json({ error: 'q is required and must be <= 200 characters' }, { status: 400 });
  }
  if (ids.length < 1 || ids.length > 3 || ids.some((id) => !UUID_RE.test(id))) {
    return Response.json({ error: 'between 1 and 3 valid jobId values are required' }, { status: 400 });
  }

  const settled = await Promise.allSettled(ids.map((id) => getCrawlJob(id)));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const statusFailures = settled.length - jobs.length;
  const warnings: string[] = [];

  if (statusFailures > 0) warnings.push('部分深度查找状态暂时不可用。');

  const allKnown = jobs.length === ids.length;
  const terminal = allKnown && jobs.every((job) => TERMINAL.has(job.status));
  let libraryResults: Awaited<ReturnType<typeof searchLibrary>> = [];

  if (terminal) {
    try {
      libraryResults = await searchLibrary(query);
    } catch {
      warnings.push('深度查找已完成，但本站文件库刷新暂时失败。');
    }
  }

  return Response.json({
    state: terminal ? 'complete' : 'running',
    jobs,
    libraryResults,
    ...(warnings.length ? { warnings } : {}),
  }, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
