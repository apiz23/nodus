/**
 * Personal sync relay HTTP server.
 *
 * Endpoints:
 *   GET  /health            public
 *   GET  /vault             public
 *   POST /pair              public (rate-limited, requires valid pairing code)
 *   POST /push              device auth
 *   GET  /pull              device auth
 *   GET  /operations        device auth
 *   GET  /device/state      device auth
 *   GET  /snapshot          device auth
 *   GET  /docs/:kind/:id    device auth
 *   GET  /devices           admin only
 *   POST /revoke            admin only
 *
 * All errors return a structured JSON body with a request ID. No secrets,
 * tokens, pairing codes, note content, titles, or paths are logged.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { RelayDatabase } from './db.js';
import type { AuthService } from './auth.js';
import type { SyncService } from './sync.js';
import type { DocumentKind, SyncIdentity, VaultIdentity } from '../sync/contracts.js';
import { PROTOCOL_VERSION } from './contracts.js';
import { RelayError } from './errors.js';
import type { PushRequest } from './contracts.js';
import type { ChangeInput } from '../sync/contracts.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;
const DEFAULT_PULL_LIMIT = 100;
const MAX_PULL_LIMIT = 1000;
const DEFAULT_SNAPSHOT_LIMIT = 50;
const MAX_SNAPSHOT_LIMIT = 500;

export interface RelayServerOptions {
  db: RelayDatabase;
  auth: AuthService;
  sync: SyncService;
  identity: VaultIdentity;
  adminToken: string;
  host?: string;
  port?: number;
}

interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  url: string;
}

export function createRelayServer(options: RelayServerOptions): Server {
  const { auth, sync, identity, adminToken } = options;

  const server = createServer((req, res) => {
    const ctx: RequestContext = {
      requestId: randomUUID(),
      method: req.method ?? 'GET',
      path: normalizePath(req.url ?? '/'),
      headers: req.headers,
      url: req.url ?? '/',
    };

    handleRequest(ctx, req, res).catch((error) => {
      sendError(res, ctx, error);
    });

    res.on('finish', () => {
      // Content-free access log.
      console.log(`${ctx.requestId} ${ctx.method} ${ctx.path} ${res.statusCode}`);
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  async function handleRequest(
    ctx: RequestContext,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (ctx.method === 'GET' && ctx.path === '/health') {
      return sendJson(res, 200, { status: 'ok', requestId: ctx.requestId });
    }

    if (ctx.method === 'GET' && ctx.path === '/vault') {
      return sendJson(res, 200, {
        vaultId: identity.vaultId,
        epoch: identity.epoch,
        protocolVersion: PROTOCOL_VERSION,
      });
    }

    if (ctx.method === 'POST' && ctx.path === '/pair') {
      const body = await readJson(req, ctx);
      const clientKey = clientIdentifier(req);
      const result = await auth.pair(
        { pairingCode: String(body.pairingCode ?? ''), deviceName: String(body.deviceName ?? '') },
        clientKey,
      );
      return sendJson(res, 200, result);
    }

    if (ctx.method === 'POST' && ctx.path === '/push') {
      const device = await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      const body = await readJson(req, ctx);
      const pushReq = parsePushRequest(body, ctx);
      const result = sync.push(device.deviceId, pushReq, identity);
      return sendJson(res, 200, result);
    }

    if (ctx.method === 'GET' && ctx.path === '/pull') {
      const device = await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      const { cursor, limit } = parsePullQuery(ctx.url);
      const result = sync.pull(cursor, limit, identity);
      return sendJson(res, 200, result);
    }

    if (ctx.method === 'GET' && ctx.path === '/operations') {
      const device = await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      const { fromDeviceSeq, toDeviceSeq } = parseOperationsQuery(ctx.url);
      const result = sync.operations(device.deviceId, fromDeviceSeq, toDeviceSeq, identity);
      return sendJson(res, 200, { operations: result });
    }

    if (ctx.method === 'GET' && ctx.path === '/device/state') {
      const device = await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      return sendJson(res, 200, sync.deviceState(device.deviceId, identity));
    }

    if (ctx.method === 'GET' && ctx.path === '/snapshot') {
      await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      const { after, limit } = parseSnapshotQuery(ctx.url);
      const result = sync.snapshot(after, limit, identity);
      return sendJson(res, 200, result);
    }

    const documentMatch = /^\/docs\/(note|database)\/([^/]+)$/.exec(ctx.path);
    if (ctx.method === 'GET' && documentMatch !== null) {
      await requireDeviceAuth(ctx, auth);
      requireProtocolVersion(ctx);
      const identity = requireSyncIdentity(ctx);
      const kind = documentMatch[1] as DocumentKind;
      const id = decodeURIComponent(documentMatch[2] ?? '');
      const version = parseVersionQuery(ctx.url);
      const result = sync.document(kind, id, version, identity);
      return sendJson(res, 200, result);
    }

    if (ctx.method === 'GET' && ctx.path === '/devices') {
      requireAdmin(ctx, adminToken);
      const devices = await auth.listDevices();
      return sendJson(res, 200, { devices });
    }

    if (ctx.method === 'POST' && ctx.path === '/revoke') {
      requireAdmin(ctx, adminToken);
      const body = await readJson(req, ctx);
      await auth.revoke({ deviceId: String(body.deviceId ?? '') });
      return sendJson(res, 200, { revoked: true });
    }

    throw new RelayError('NOT_FOUND', `No route ${ctx.method} ${ctx.path}`, {
      requestId: ctx.requestId,
      statusCode: 404,
    });
  }

  return server;
}

function normalizePath(url: string): string {
  const index = url.indexOf('?');
  const path = index === -1 ? url : url.slice(0, index);
  return path.replace(/\/$/, '') || '/';
}

function queryParams(url: string): URLSearchParams {
  const index = url.indexOf('?');
  const query = index === -1 ? '' : url.slice(index + 1);
  return new URLSearchParams(query);
}

function requireAdmin(ctx: RequestContext, adminToken: string): void {
  const header = ctx.headers['authorization'] ?? '';
  const expected = `Bearer ${adminToken}`;
  if (typeof header !== 'string' || !timingSafeEqual(header, expected)) {
    throw new RelayError('UNAUTHORIZED', 'Admin token required', { requestId: ctx.requestId });
  }
}

async function requireDeviceAuth(ctx: RequestContext, auth: AuthService): Promise<{ deviceId: string }> {
  const header = ctx.headers['authorization'] ?? '';
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new RelayError('UNAUTHORIZED', 'Device token required', { requestId: ctx.requestId });
  }
  const token = header.slice('Bearer '.length);
  const device = await auth.verifyToken(token);
  return { deviceId: device.deviceId };
}

function requireProtocolVersion(ctx: RequestContext): void {
  const value = ctx.headers['x-nodus-protocol-version'];
  if (value !== '1') {
    throw new RelayError('INVALID_INPUT', 'Unsupported protocol version', {
      requestId: ctx.requestId,
      details: { expected: 1, received: value },
    });
  }
}

function requireSyncIdentity(ctx: RequestContext): SyncIdentity {
  const vaultId = ctx.headers['x-nodus-vault-id'];
  const rawEpoch = ctx.headers['x-nodus-epoch'];
  if (typeof vaultId !== 'string' || typeof rawEpoch !== 'string') {
    throw new RelayError('INVALID_INPUT', 'Vault identity headers are required', {
      requestId: ctx.requestId,
      details: { required: ['X-Nodus-Vault-Id', 'X-Nodus-Epoch'] },
    });
  }
  const epoch = Number.parseInt(rawEpoch, 10);
  if (!Number.isInteger(epoch) || epoch < 1) {
    throw new RelayError('INVALID_INPUT', 'X-Nodus-Epoch must be a positive integer', {
      requestId: ctx.requestId,
    });
  }
  return { vaultId, epoch };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function clientIdentifier(req: IncomingMessage): string {
  return String(req.socket.remoteAddress ?? 'unknown');
}

async function readJson(req: IncomingMessage, ctx: RequestContext): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += (chunk as Buffer).length;
    if (length > MAX_BODY_BYTES) {
      throw new RelayError('INVALID_INPUT', 'Request body too large', { requestId: ctx.requestId });
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RelayError('INVALID_INPUT', 'Request body must be a JSON object', { requestId: ctx.requestId });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError('INVALID_INPUT', 'Invalid JSON body', { requestId: ctx.requestId, cause: error });
  }
}

function parsePushRequest(body: Record<string, unknown>, ctx: RequestContext): PushRequest {
  if (typeof body.operationId !== 'string' || body.operationId.length === 0) {
    throw new RelayError('INVALID_INPUT', 'operationId is required', { requestId: ctx.requestId });
  }
  if (!Number.isInteger(body.deviceSeq) || (body.deviceSeq as number) < 1) {
    throw new RelayError('INVALID_INPUT', 'deviceSeq must be a positive integer', { requestId: ctx.requestId });
  }
  if (!Array.isArray(body.changes)) {
    throw new RelayError('INVALID_INPUT', 'changes must be an array', { requestId: ctx.requestId });
  }
  const changes = (body.changes as unknown[]).map((item, index) => parseChangeInput(item, ctx, index));
  return {
    operationId: body.operationId,
    deviceSeq: body.deviceSeq as number,
    changes,
  };
}

function parseChangeInput(item: unknown, ctx: RequestContext, index: number): ChangeInput {
  if (typeof item !== 'object' || item === null) {
    throw new RelayError('INVALID_INPUT', `changes[${index}] must be an object`, { requestId: ctx.requestId });
  }
  const c = item as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'note' && kind !== 'database') {
    throw new RelayError('INVALID_INPUT', `changes[${index}].kind must be note or database`, { requestId: ctx.requestId });
  }
  if (typeof c.id !== 'string') {
    throw new RelayError('INVALID_INPUT', `changes[${index}].id must be a string`, { requestId: ctx.requestId });
  }
  if (typeof c.path !== 'string') {
    throw new RelayError('INVALID_INPUT', `changes[${index}].path must be a string`, { requestId: ctx.requestId });
  }
  if (typeof c.contentHash !== 'string') {
    throw new RelayError('INVALID_INPUT', `changes[${index}].contentHash must be a string`, { requestId: ctx.requestId });
  }
  const op = c.op;
  if (op !== 'create' && op !== 'update' && op !== 'move' && op !== 'delete') {
    throw new RelayError('INVALID_INPUT', `changes[${index}].op must be create/update/move/delete`, { requestId: ctx.requestId });
  }
  if (!Number.isInteger(c.baseVersion) || (c.baseVersion as number) < 0) {
    throw new RelayError('INVALID_INPUT', `changes[${index}].baseVersion must be a non-negative integer`, { requestId: ctx.requestId });
  }
  if (!Number.isInteger(c.version) || (c.version as number) < 1) {
    throw new RelayError('INVALID_INPUT', `changes[${index}].version must be a positive integer`, { requestId: ctx.requestId });
  }
  return {
    kind,
    id: c.id,
    op,
    baseVersion: c.baseVersion as number,
    version: c.version as number,
    path: c.path,
    contentHash: c.contentHash,
    content: typeof c.content === 'string' ? c.content : undefined,
    previousPath: typeof c.previousPath === 'string' ? c.previousPath : undefined,
  };
}

function parsePullQuery(url: string): { cursor?: string; limit: number } {
  const params = queryParams(url);
  const cursor = params.get('cursor') ?? undefined;
  const rawLimit = params.get('limit');
  let limit = DEFAULT_PULL_LIMIT;
  if (rawLimit !== null) {
    limit = parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_PULL_LIMIT) {
      throw new RelayError('INVALID_INPUT', `limit must be between 1 and ${MAX_PULL_LIMIT}`, { requestId: 'sync' });
    }
  }
  return { cursor, limit };
}

function parseOperationsQuery(url: string): { fromDeviceSeq: number; toDeviceSeq?: number } {
  const params = queryParams(url);
  const rawFrom = params.get('fromDeviceSeq');
  const rawTo = params.get('toDeviceSeq');
  if (rawFrom === null || !Number.isInteger(Number(rawFrom))) {
    throw new RelayError('INVALID_INPUT', 'fromDeviceSeq is required', { requestId: 'sync' });
  }
  const fromDeviceSeq = parseInt(rawFrom, 10);
  const toDeviceSeq = rawTo === null ? undefined : parseInt(rawTo, 10);
  if (toDeviceSeq !== undefined && (!Number.isInteger(toDeviceSeq) || toDeviceSeq < fromDeviceSeq)) {
    throw new RelayError('INVALID_INPUT', 'toDeviceSeq must be >= fromDeviceSeq', { requestId: 'sync' });
  }
  return { fromDeviceSeq, toDeviceSeq };
}

function parseSnapshotQuery(url: string): { after?: string; limit: number } {
  const params = queryParams(url);
  const after = params.get('after') ?? undefined;
  const rawLimit = params.get('limit');
  let limit = DEFAULT_SNAPSHOT_LIMIT;
  if (rawLimit !== null) {
    limit = parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_SNAPSHOT_LIMIT) {
      throw new RelayError('INVALID_INPUT', `snapshot limit must be between 1 and ${MAX_SNAPSHOT_LIMIT}`, {
        requestId: 'sync',
      });
    }
  }
  return { after, limit };
}

function parseVersionQuery(url: string): number | undefined {
  const raw = queryParams(url).get('version');
  if (raw === null) return undefined;
  const version = Number.parseInt(raw, 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new RelayError('INVALID_INPUT', 'version must be a positive integer', {
      requestId: 'sync',
    });
  }
  return version;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, ctx: RequestContext, error: unknown): void {
  if (error instanceof RelayError) {
    res.writeHead(error.statusCode, { 'Content-Type': 'application/json' });
    const response = error.toResponse();
    response.error.requestId = ctx.requestId;
    res.end(JSON.stringify(response));
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const safe = process.env.NODE_ENV === 'production' ? 'Internal server error' : message;
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: safe, requestId: ctx.requestId },
    }),
  );
}
