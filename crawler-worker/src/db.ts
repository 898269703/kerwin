import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { Pool } = pg;
export function createPool(connectionString: string) {
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

export async function migrate(pool: { query(text: string): Promise<unknown> }): Promise<void> {
  const sql = await readFile(resolve(process.cwd(), 'migrations/001_init.sql'), 'utf8');
  await pool.query(sql);
}
