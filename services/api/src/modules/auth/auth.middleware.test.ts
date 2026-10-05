import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedRequest } from './auth.middleware.js';

const testSecret = 'unit-test-only-secret-with-more-than-thirty-two-bytes';
const testIssuer = 'service-remoto-api-test';
const testAudience = 'service-remoto-client-test';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:5432/test';
process.env['JWT_SECRET'] = testSecret;
process.env['JWT_ISSUER'] = testIssuer;
process.env['JWT_AUDIENCE'] = testAudience;
process.env['CLIENT_ORIGIN'] = 'http://localhost:5173';

const { requireAuth, requireRole } = await import('./auth.middleware.js');
const { authRouter } = await import('./auth.routes.js');
const { computerRouter } = await import('../computers/computer.routes.js');
const { ticketRouter } = await import('../tickets/ticket.routes.js');

const app = express();
app.use(express.json());
app.get('/client-only', requireAuth, requireRole('CLIENT'), (request: AuthenticatedRequest, response) => {
  response.json({ userId: request.userId, role: request.userRole });
});
app.get('/technician-only', requireAuth, requireRole('TECHNICIAN', 'ADMIN'), (_request, response) => {
  response.json({ allowed: true });
});
app.use('/auth', authRouter);
app.use('/computers', computerRouter);
app.use('/tickets', ticketRouter);

const server: Server = createServer(app);
let baseUrl: string;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function makeToken(
  role: string,
  options: { issuer?: string; audience?: string; algorithm?: jwt.Algorithm } = {},
) {
  return jwt.sign(
    { role },
    testSecret,
    {
      algorithm: options.algorithm ?? 'HS256',
      audience: options.audience ?? testAudience,
      expiresIn: '1h',
      issuer: options.issuer ?? testIssuer,
      subject: '42',
    },
  );
}

async function get(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function sendJson(path: string, token: string, method: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('protected routes reject requests without a token', async () => {
  const response = await get('/client-only');
  assert.equal(response.status, 401);
});

test('protected routes reject tokens with the wrong signature', async () => {
  const invalidToken = jwt.sign(
    { role: 'CLIENT' },
    'a-different-test-secret-that-is-long-enough',
    { algorithm: 'HS256', subject: '42', issuer: testIssuer, audience: testAudience },
  );
  const response = await get('/client-only', invalidToken);
  assert.equal(response.status, 401);
});

test('protected routes reject tokens with a different issuer or audience', async () => {
  const wrongIssuer = await get('/client-only', makeToken('CLIENT', { issuer: 'other-api' }));
  const wrongAudience = await get('/client-only', makeToken('CLIENT', { audience: 'other-client' }));
  assert.equal(wrongIssuer.status, 401);
  assert.equal(wrongAudience.status, 401);
});

test('protected routes reject tokens signed with an unexpected algorithm', async () => {
  const response = await get('/client-only', makeToken('CLIENT', { algorithm: 'HS384' }));
  assert.equal(response.status, 401);
});

test('client tokens cannot access technician actions', async () => {
  const response = await get('/technician-only', makeToken('CLIENT'));
  assert.equal(response.status, 403);
});

test('technician tokens cannot access client-only actions', async () => {
  const response = await get('/client-only', makeToken('TECHNICIAN'));
  assert.equal(response.status, 403);
});

test('technicians cannot register client computers', async () => {
  const response = await sendJson('/computers', makeToken('TECHNICIAN'), 'POST', {});
  assert.equal(response.status, 403);
});

test('computer routes reject requests without authentication', async () => {
  const response = await get('/computers');
  assert.equal(response.status, 401);
});

test('computer registration rejects missing fields', async () => {
  const response = await sendJson('/computers', makeToken('CLIENT'), 'POST', {});
  assert.equal(response.status, 400);
});

test('computer registration rejects malformed RustDesk IDs before database access', async () => {
  const response = await sendJson('/computers', makeToken('CLIENT'), 'POST', {
    os: 'Windows',
    ram: '16 GB',
    storageFree: '250 GB',
    rustdeskId: '123/456',
  });
  assert.equal(response.status, 400);
});

test('computer status updates reject invalid IDs and statuses before database access', async () => {
  const invalidId = await sendJson('/computers/not-a-number/status', makeToken('CLIENT'), 'PATCH', {
    status: 'ONLINE',
  });
  const invalidStatus = await sendJson('/computers/1/status', makeToken('CLIENT'), 'PATCH', {
    status: 'UNKNOWN',
  });
  assert.equal(invalidId.status, 400);
  assert.equal(invalidStatus.status, 400);
});

test('ticket routes reject requests without authentication', async () => {
  const response = await get('/tickets');
  assert.equal(response.status, 401);
});

test('clients cannot claim technician tickets', async () => {
  const response = await sendJson('/tickets/1/claim', makeToken('CLIENT'), 'PATCH', {});
  assert.equal(response.status, 403);
});

test('ticket creation rejects malformed computer IDs before database access', async () => {
  const response = await sendJson('/tickets', makeToken('CLIENT'), 'POST', {
    computerId: 'not-a-number',
  });
  assert.equal(response.status, 400);
});

test('technician ticket actions reject malformed ticket IDs before database access', async () => {
  const token = makeToken('TECHNICIAN');
  const claim = await sendJson('/tickets/not-a-number/claim', token, 'PATCH', {});
  const close = await sendJson('/tickets/not-a-number/close', token, 'PATCH', {});
  const connect = await sendJson('/tickets/not-a-number/connect', token, 'POST', {});
  assert.equal(claim.status, 400);
  assert.equal(close.status, 400);
  assert.equal(connect.status, 400);
});

test('technicians cannot create client support tickets', async () => {
  const response = await sendJson('/tickets', makeToken('TECHNICIAN'), 'POST', {});
  assert.equal(response.status, 403);
});

test('valid client tokens are accepted by client-only routes', async () => {
  const response = await get('/client-only', makeToken('CLIENT'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: 42, role: 'CLIENT' });
});

test('registration rejects requests without diagnostic consent before accessing the database', async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.invalid',
      password: 'valid-test-password',
    }),
  });
  assert.equal(response.status, 400);
});

test('registration rejects invalid email and short passwords before database access', async () => {
  const invalidEmail = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'not-an-email',
      password: 'valid-test-password',
      diagnosticConsentAccepted: true,
    }),
  });
  const shortPassword = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.invalid',
      password: 'short',
      diagnosticConsentAccepted: true,
    }),
  });
  assert.equal(invalidEmail.status, 400);
  assert.equal(shortPassword.status, 400);
});
