import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { authRouter } from './modules/auth/auth.routes.js';
import { computerRouter } from './modules/computers/computer.routes.js';
import { ticketRouter } from './modules/tickets/ticket.routes.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { env } from './config/env.js';
import { pool } from './infrastructure/database/pool.js';

export const app = express();

const allowedOrigins = new Set([
  env.CLIENT_ORIGIN,
  ...(env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : []),
]);

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
}));
app.use('/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '32kb' }));
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/auth', authRouter);
app.use('/computers', computerRouter);
app.use('/tickets', ticketRouter);
app.use('/payments', paymentRouter);

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'service-remoto-api',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({
      status: 'ready',
      service: 'service-remoto-api',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      'Database readiness check failed:',
      error instanceof Error ? error.name : 'unknown error',
    );
    response.status(503).json({
      status: 'not_ready',
      service: 'service-remoto-api',
    });
  }
});
