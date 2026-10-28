import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import 'dotenv/config';
import pg from 'pg';
import { WebSocket } from 'ws';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required to run API integration tests');
}
const testDatabaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
if (!testDatabaseName.endsWith('_test')) {
  throw new Error('Integration tests may only use a database whose name ends with _test');
}

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['JWT_SECRET'] = 'integration-test-only-secret-with-at-least-thirty-two-bytes';
process.env['JWT_ISSUER'] = 'service-remoto-api-integration-test';
process.env['JWT_AUDIENCE'] = 'service-remoto-client-integration-test';
process.env['CLIENT_ORIGIN'] = 'http://127.0.0.1:5173';

const { pool } = await import('./infrastructure/database/pool.js');
const { app } = await import('./app.js');
const { setupTechnicianWebSocket } = await import('./infrastructure/realtime/technician-hub.js');

const server: Server = createServer(app);
setupTechnicianWebSocket(server);
let baseUrl: string;
let clientToken: string;
let technicianToken: string;
let ticketId: number;
let computerId: number;
let clientSocket: WebSocket | null = null;
let browserSocket: WebSocket | null = null;

async function requestJson<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown; origin?: string } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json().catch(() => null) as T | null;
  return { response, body };
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS "connectionAuditLog", payment, ticket, computer, "user" CASCADE;
    CREATE TABLE "user" (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'CLIENT',
      "diagnosticConsentAt" TIMESTAMPTZ,
      "diagnosticConsentVersion" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE computer (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES "user"(id),
      os TEXT NOT NULL,
      ram TEXT NOT NULL,
      "storageFree" TEXT NOT NULL,
      "rustdeskId" TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'OFFLINE'
    );
    CREATE TABLE ticket (
      id SERIAL PRIMARY KEY,
      "clientId" INTEGER NOT NULL REFERENCES "user"(id),
      "technicianId" INTEGER REFERENCES "user"(id),
      "computerId" INTEGER REFERENCES computer(id),
      status TEXT NOT NULL DEFAULT 'PENDING',
      "rustdeskSessionToken" TEXT NOT NULL UNIQUE,
      "connectedAt" TIMESTAMPTZ,
      "disconnectedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE "connectionAuditLog" (
      id SERIAL PRIMARY KEY,
      "ticketId" INTEGER NOT NULL REFERENCES ticket(id) ON DELETE RESTRICT,
      "technicianId" INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      reason TEXT
    );
    CREATE TABLE payment (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES "user"(id),
      "stripeSubscriptionId" TEXT UNIQUE,
      "stripeCheckoutSessionId" TEXT UNIQUE,
      amount NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  clientSocket?.close();
  browserSocket?.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await pool.query('TRUNCATE TABLE "connectionAuditLog", payment, ticket, computer, "user" RESTART IDENTITY CASCADE');
  await pool.end();
});

test('client-to-technician ticket lifecycle works end to end', async () => {
  const suffix = randomUUID();
  const clientRegistration = await requestJson<{ user: { id: number }; token: string }>('/auth/register', {
    method: 'POST',
    body: {
      name: 'Integration Client',
      email: `client-${suffix}@example.invalid`,
      password: 'valid-integration-password',
      diagnosticConsentAccepted: true,
    },
  });
  assert.equal(clientRegistration.response.status, 201);
  assert.ok(clientRegistration.body?.token);
  clientToken = clientRegistration.body!.token;

  const consentRecord = await pool.query(
    'SELECT "diagnosticConsentAt", "diagnosticConsentVersion" FROM "user" WHERE id = $1',
    [clientRegistration.body!.user.id],
  );
  assert.ok(consentRecord.rows[0].diagnosticConsentAt);
  assert.ok(consentRecord.rows[0].diagnosticConsentVersion);

  const clientLogin = await requestJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: {
      email: `client-${suffix}@example.invalid`,
      password: 'valid-integration-password',
    },
  });
  assert.equal(clientLogin.response.status, 200);
  assert.ok(clientLogin.body?.token);
  clientToken = clientLogin.body!.token;

  const technicianRegistration = await requestJson<{ user: { id: number } }>('/auth/register', {
    method: 'POST',
    body: {
      name: 'Integration Technician',
      email: `technician-${suffix}@example.invalid`,
      password: 'valid-integration-password',
      diagnosticConsentAccepted: true,
    },
  });
  assert.equal(technicianRegistration.response.status, 201);
  await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ['TECHNICIAN', technicianRegistration.body!.user.id]);
  const technicianLogin = await requestJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: {
      email: `technician-${suffix}@example.invalid`,
      password: 'valid-integration-password',
    },
  });
  assert.equal(technicianLogin.response.status, 200);
  assert.ok(technicianLogin.body?.token);
  technicianToken = technicianLogin.body!.token;

  const createdComputer = await requestJson<{ computer: { id: number; rustdeskId: string } }>('/computers', {
    method: 'POST',
    token: clientToken,
    body: {
      os: 'Windows 11',
      ram: '16 GB',
      storageFree: '250 GB',
      rustdeskId: `test ${suffix.slice(0, 8)}`,
    },
  });
  assert.equal(createdComputer.response.status, 201);
  assert.equal(createdComputer.body?.computer.rustdeskId, `test${suffix.slice(0, 8)}`);
  computerId = createdComputer.body!.computer.id;

  const createdTicket = await requestJson<{ ticket: { id: number; status: string } }>('/tickets', {
    method: 'POST',
    token: clientToken,
    body: { computerId },
  });
  assert.equal(createdTicket.response.status, 201);
  assert.equal(createdTicket.body?.ticket.status, 'PENDING');
  ticketId = createdTicket.body!.ticket.id;

  const duplicateTicket = await requestJson('/tickets', {
    method: 'POST',
    token: clientToken,
    body: { computerId },
  });
  assert.equal(duplicateTicket.response.status, 409);

  const clientTickets = await requestJson<{ tickets: Array<{ id: number }> }>('/tickets', { token: clientToken });
  assert.equal(clientTickets.response.status, 200);
  assert.deepEqual(clientTickets.body?.tickets.map((ticket) => ticket.id), [ticketId]);

  const technicianQueue = await requestJson<{ tickets: Array<{ id: number }> }>('/tickets', { token: technicianToken });
  assert.equal(technicianQueue.response.status, 200);
  assert.ok(technicianQueue.body?.tickets.some((ticket) => ticket.id === ticketId));

  const claimedTicket = await requestJson<{ ticket: { status: string; technicianId: number } }>(
    `/tickets/${ticketId}/claim`,
    { method: 'PATCH', token: technicianToken },
  );
  assert.equal(claimedTicket.response.status, 200);
  assert.equal(claimedTicket.body?.ticket.status, 'ACTIVE');
  assert.equal(claimedTicket.body?.ticket.technicianId, technicianRegistration.body!.user.id);

  clientSocket = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/ws/agent`,
    { headers: { Authorization: `Bearer ${clientToken}` } },
  );
  await once(clientSocket, 'open');
  const requestEvent = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for client connection request')), 2000);
    const onMessage = (message: Buffer) => {
      const parsed = JSON.parse(message.toString()) as Record<string, unknown>;
      if (parsed.type !== 'connection.requested') return;
      clearTimeout(timeout);
      clientSocket!.off('message', onMessage);
      resolve(parsed);
    };
    clientSocket!.on('message', onMessage);
  });

  const preparedConnection = await requestJson<{
    delivered: boolean;
    rustdeskId: string;
  }>(
    `/tickets/${ticketId}/connect`,
    { method: 'POST', token: technicianToken },
  );
  assert.equal(preparedConnection.response.status, 200);
  assert.equal(preparedConnection.body?.delivered, true);
  assert.equal(preparedConnection.body?.rustdeskId, `test${suffix.slice(0, 8)}`);
  const deliveredEvent = await requestEvent;
  assert.equal(deliveredEvent.type, 'connection.requested');
  assert.deepEqual(deliveredEvent.request, {
    ticketId,
    technicianId: technicianRegistration.body!.user.id,
    technicianName: 'Integration Technician',
    rustdeskId: `test${suffix.slice(0, 8)}`,
  });

  const connectionAudit = await pool.query(
    'SELECT "connectedAt" FROM ticket WHERE id = $1',
    [ticketId],
  );
  assert.equal(connectionAudit.rows[0].connectedAt, null);

  const technicianCannotApprove = await requestJson(`/tickets/${ticketId}/approve`, {
    method: 'POST',
    token: technicianToken,
  });
  assert.equal(technicianCannotApprove.response.status, 403);

  const clientApproved = await requestJson<{ approval: { ticketId: number; technicianId: number } }>(
    `/tickets/${ticketId}/approve`,
    { method: 'POST', token: clientToken },
  );
  assert.equal(clientApproved.response.status, 200);
  assert.equal(clientApproved.body?.approval.ticketId, ticketId);
  assert.equal(clientApproved.body?.approval.technicianId, technicianRegistration.body!.user.id);

  browserSocket = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/ws/client?token=${encodeURIComponent(clientToken)}`,
  );
  await once(browserSocket, 'open');
  clientSocket.close();
  await once(clientSocket, 'close');
  const requestWithoutAgent = await requestJson<{ delivered: boolean }>(
    `/tickets/${ticketId}/connect`,
    { method: 'POST', token: technicianToken },
  );
  assert.equal(requestWithoutAgent.response.status, 200);
  assert.equal(requestWithoutAgent.body?.delivered, false);

  const clientCannotClaim = await requestJson(`/tickets/${ticketId}/claim`, {
    method: 'PATCH',
    token: clientToken,
  });
  assert.equal(clientCannotClaim.response.status, 403);

  const technicianCannotDecline = await requestJson(`/tickets/${ticketId}/decline`, {
    method: 'POST',
    token: technicianToken,
  });
  assert.equal(technicianCannotDecline.response.status, 403);

  const clientDeclined = await requestJson<{ ticket: { status: string } }>(
    `/tickets/${ticketId}/decline`,
    { method: 'POST', token: clientToken },
  );
  assert.equal(clientDeclined.response.status, 200);
  assert.equal(clientDeclined.body?.ticket.status, 'CLOSED');
  const declinedAudit = await pool.query(
    'SELECT count(*)::int AS count FROM "connectionAuditLog" WHERE "ticketId" = $1',
    [ticketId],
  );
  assert.equal(declinedAudit.rows[0].count, 0);

  const technicianCannotReopen = await requestJson(
    `/tickets/${ticketId}/close`,
    { method: 'PATCH', token: technicianToken },
  );
  assert.equal(technicianCannotReopen.response.status, 409);

  const clientTicketsAfterClose = await requestJson<{ tickets: Array<{ status: string }> }>('/tickets', {
    token: clientToken,
  });
  assert.equal(clientTicketsAfterClose.response.status, 200);
  assert.equal(clientTicketsAfterClose.body?.tickets[0]?.status, 'CLOSED');
});

test('health endpoint responds and CORS only allows the configured client origin', async () => {
  const health = await requestJson<{ status: string }>('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body?.status, 'ok');
  assert.equal(health.response.headers.get('x-powered-by'), null);
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');

  const ready = await requestJson<{ status: string }>('/ready');
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body?.status, 'ready');

  const allowedOrigin = await fetch(`${baseUrl}/health`, { headers: { Origin: 'http://127.0.0.1:5173' } });
  const blockedOrigin = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://not-allowed.example' } });
  assert.equal(allowedOrigin.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  assert.equal(blockedOrigin.headers.get('access-control-allow-origin'), null);
});

test('authentication rate limit blocks repeated invalid login requests', async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await requestJson('/auth/login', {
      method: 'POST',
      body: { email: 'missing@example.invalid', password: 'valid-test-password' },
    });
    lastStatus = result.response.status;
    if (lastStatus === 429) break;
  }
  assert.equal(lastStatus, 429);
});
