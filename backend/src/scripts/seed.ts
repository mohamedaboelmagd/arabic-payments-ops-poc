import { seedWorld } from '../domain/seed.js';
import { sha256 } from '../services/crypto.js';
import { memoryStore, openPostgresStore } from '../services/store.js';

const url = process.env.DATABASE_URL?.trim();
if (url) {
  const store = await openPostgresStore(url, () => seedWorld(sha256));
  await store.save(await seedWorld(sha256));
  console.log('seeded postgres');
} else {
  const world = await seedWorld(sha256);
  memoryStore(world);
  console.log(`seeded memory world with ${world.payments.length} payments and ${world.audit.length} audit entries`);
}
