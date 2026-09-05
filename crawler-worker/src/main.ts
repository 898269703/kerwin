import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { createPool, migrate } from './db.ts';
import { DocumentRepository } from './repositories.ts';
import { SerialWorkQueue } from './scheduler.ts';
import { createRuntimeCallbacks } from './runtime.ts';
import { createHttpServer } from './http-server.ts';

const config = loadConfig();
await mkdir(join(config.dataDir, 'pdfs'), { recursive: true });
await mkdir(join(config.dataDir, 'tmp'), { recursive: true });
await mkdir(join(config.dataDir, 'crawlee'), { recursive: true });

const pool = createPool(config.databaseUrl);
await migrate(pool);

const repo = new DocumentRepository({
  query: async <T = Record<string, unknown>>(text: string, values?: unknown[]) => {
    const result = await pool.query(text, values);
    return { rows: result.rows as T[] };
  },
});
const queue = new SerialWorkQueue();
const callbacks = createRuntimeCallbacks({ queue, repo, config });

const server = createHttpServer({
  repo,
  apiToken: config.apiToken,
  dataRoot: config.dataDir,
  healthCheck: async () => {
    await pool.query('SELECT 1');
    return true;
  },
  enqueueJob: callbacks.enqueueJob,
  enqueueIngest: callbacks.enqueueIngest,
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, '0.0.0.0', () => resolve());
});
console.log(`[crawler] listening on 0.0.0.0:${config.port}`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[crawler] received ${signal}, shutting down`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await queue.whenIdle();
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
