import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyRequest } from 'fastify';
import { AppError, DEMO_API_KEY, type User } from './domain/index.js';
import { routes } from './routes/api.js';
import type { Repository } from './services/store.js';

declare module 'fastify' {
  interface FastifyRequest {
    actorUser: User;
  }
}

export interface AppOptions {
  repo: Repository;
  staticDir?: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1 * 1024 * 1024 }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, {
    origin: [/^http:\/\/localhost(:\d+)?$/],
    allowedHeaders: ['content-type', 'x-api-key', 'x-actor', 'idempotency-key'],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Payments Operations API (PoC)',
        version: '0.1.0',
        description:
          'Arabic-first payments operations console for a fictional treasury desk. ' +
          'Authenticate with `x-api-key: demo_delta_ops_key` and pick a role via `x-actor` ' +
          '(layla.maker, omar.checker, nora.auditor, ahmed.admin, sara.viewer). ' +
          'Money is integer minor units. Every state change is written to a hash-chained audit log. ' +
          'All sample data is fictional.',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          actor: { type: 'apiKey', in: 'header', name: 'x-actor' },
        },
      },
      security: [{ apiKey: [] }, { actor: [] }],
      tags: [
        { name: 'payments', description: 'Payment instructions and the state machine' },
        { name: 'ledger', description: 'Double-entry journal' },
        { name: 'rules', description: 'Limit and screening hits' },
        { name: 'audit', description: 'Hash-chained audit trail' },
        { name: 'util', description: 'Arabic normalisation helpers' },
        { name: 'session', description: 'Current user and demo reset' },
        { name: 'reports', description: 'Queue summary' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.decorateRequest('actorUser', null as unknown as User);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/')) return;
    if (req.url.startsWith('/api/v1/normalize')) {
      // Still require the demo key so the route is not an open relay, but allow missing actor.
    }
    const key = req.headers['x-api-key'];
    if (key !== DEMO_API_KEY) {
      return reply.code(401).send({ error: 'unauthorized', message: 'missing or invalid x-api-key' });
    }
    const world = await opts.repo.read((w) => w);
    const raw = String(req.headers['x-actor'] ?? 'layla.maker');
    const actor = world.users.find((u) => u.username === raw || u.id === raw);
    if (!actor) return reply.code(401).send({ error: 'unauthorized', message: 'unknown x-actor' });
    req.actorUser = actor;
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...err.extra });
    }
    const anyErr = err as { validation?: unknown; message?: string; statusCode?: number };
    if (anyErr.validation) {
      return reply.code(400).send({ error: 'bad_request', message: anyErr.message });
    }
    req.log?.error(err);
    return reply.code(anyErr.statusCode ?? 500).send({ error: 'internal', message: anyErr.message ?? 'internal error' });
  });

  await routes(app, opts.repo);

  const staticDir = opts.staticDir ?? join(process.cwd(), '..', 'frontend', 'dist', 'frontend', 'browser');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/docs')) {
        return reply.code(404).send({ error: 'not_found', message: 'route not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
