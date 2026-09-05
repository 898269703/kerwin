import { createPool, migrate } from './db.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
} finally {
  await pool.end();
}
