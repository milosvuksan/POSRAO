import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, Scheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(scheduler: Scheduler, production = process.env.NODE_ENV === 'production') {
  const app = express();
  const clients = new Set<Response>();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const broadcast = (snapshot = scheduler.getState()) => {
    const payload = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of clients) client.write(payload);
  };

  app.get('/api/state', (_req, res) => res.json(scheduler.getState()));

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(scheduler.getState())}\n\n`);
    req.on('close', () => clients.delete(res));
  });

  app.post('/api/resources/:resourceId/entries', (req, res) => {
    const result = scheduler.create(req.params.resourceId, req.body ?? {});
    broadcast(result.stateSnapshot);
    res.status(201).json({ ...result, serverTime: result.stateSnapshot.serverTime });
  });

  app.post('/api/access', (req, res) => {
    const result = scheduler.recover(req.body ?? {});
    res.json({ ...result, serverTime: result.stateSnapshot.serverTime });
  });

  const bearer = (req: Request) => req.get('authorization')?.replace(/^Bearer\s+/i, '');

  app.post('/api/entries/:id/extend', (req, res) => {
    const result = scheduler.extend(req.params.id, bearer(req));
    broadcast(result.stateSnapshot);
    res.json({ ...result, serverTime: result.stateSnapshot.serverTime });
  });

  app.post('/api/entries/:id/finish', (req, res) => {
    const result = scheduler.finish(req.params.id, bearer(req));
    broadcast(result.stateSnapshot);
    res.json({ ...result, serverTime: result.stateSnapshot.serverTime });
  });

  app.delete('/api/entries/:id', (req, res) => {
    const result = scheduler.cancel(req.params.id, bearer(req));
    broadcast(result.stateSnapshot);
    res.json({ ...result, serverTime: result.stateSnapshot.serverTime });
  });

  if (production) {
    const clientPath = path.resolve(__dirname, '../dist');
    app.use(express.static(clientPath, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientPath, 'index.html')));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ code: error.code, message: error.message, serverTime: Date.now() });
      return;
    }
    console.error(JSON.stringify({ level: 'error', event: 'request_failed', error: String(error) }));
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Došlo je do neočekivane greške.', serverTime: Date.now() });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref();

  return { app, broadcast };
}
