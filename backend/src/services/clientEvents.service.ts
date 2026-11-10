import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

/**
 * Server → client push channel (Server-Sent Events) for logged-in desktop
 * clients. Events are only *signals* (e.g. `NEW_TASK` with a task id); clients
 * then pull the actual payload over an authenticated request, so nothing
 * sensitive travels over the long-lived stream.
 */
interface SseConnection {
  id: string;
  userId: string;
  res: Response;
}

const HEARTBEAT_MS = 25_000;
/** Bound per-user streams so one account cannot exhaust server sockets. */
const MAX_CONNECTIONS_PER_USER = 8;
/** Only connections attached to this worker; cross-worker fan-out is done by taskDispatchWatcher. */
const connections = new Map<string, SseConnection>();

function countUserConnections(userId: string): number {
  let n = 0;
  for (const c of connections.values()) if (c.userId === userId) n++;
  return n;
}

export function registerClientSSE(userId: string, req: Request, res: Response): void {
  // Drop the oldest stream of this user when over the cap (stale half-open sockets).
  if (countUserConnections(userId) >= MAX_CONNECTIONS_PER_USER) {
    for (const [id, c] of connections) {
      if (c.userId !== userId) continue;
      connections.delete(id);
      try {
        c.res.end();
      } catch {
        // already closed
      }
      break;
    }
  }

  const id = randomUUID();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  connections.set(id, { id, userId, res });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(': ping\n\n');
    }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    connections.delete(id);
  });
}

export function notifyUsers(event: string, data: object, audience: Set<string> | 'ALL'): number {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const conn of connections.values()) {
    if (conn.res.writableEnded || conn.res.destroyed) continue;
    if (audience !== 'ALL' && !audience.has(conn.userId)) continue;
    try {
      conn.res.write(payload);
      sent++;
    } catch (err) {
      logger.warn(`[SSE] Failed writing to connection ${conn.id}:`, err);
    }
  }
  logger.debug(`[SSE] ${event} -> ${sent} local connections`);
  return sent;
}

export function getLocalConnectionCount(): number {
  return connections.size;
}
