import { createHash } from 'node:crypto';
import { emptyWorld, type KernelCtx, type User, type World } from '../src/domain/index.js';

export const sha256 = async (s: string) => createHash('sha256').update(s).digest('hex');

export function makeCtx(world: World, username = 'layla.maker'): KernelCtx {
  let n = world.audit.length + world.payments.length + 1000;
  const actor = world.users.find((u) => u.username === username) as User;
  return {
    world,
    actor,
    now: () => '2026-11-09T12:00:00.000Z',
    id: (p) => `${p}_${++n}`,
    hash: sha256,
  };
}

export function freshWorld(): World {
  return emptyWorld();
}
