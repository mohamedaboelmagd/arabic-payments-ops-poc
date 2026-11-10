import { join } from 'node:path';
import { buildApp } from './app.js';
import { seedWorld } from './domain/seed.js';
import { sha256 } from './services/crypto.js';
import { Repository, memoryStore, openPostgresStore } from './services/store.js';

const url = process.env.DATABASE_URL?.trim();
const store = url
  ? await openPostgresStore(url, () => seedWorld(sha256))
  : memoryStore(await seedWorld(sha256));

const repo = new Repository(store);
const app = await buildApp({
  repo,
  staticDir: process.env.STATIC_DIR ?? join(import.meta.dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser'),
  logger: true,
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
app.log.info(`store=${store.kind}  API docs: http://localhost:${port}/docs  dashboard: http://localhost:${port}/`);
