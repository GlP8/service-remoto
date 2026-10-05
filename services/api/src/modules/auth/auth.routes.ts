import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { loginUser, registerUser } from './auth.service.js';

export const authRouter = Router();
const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});
const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(),
  diagnosticConsentAccepted: z.literal(true),
});

const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

authRouter.post('/register', registrationRateLimit, async (request, response) => {
  const parsed = registrationSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Email, password, name and mandatory diagnostic consent are required' });
    return;
  }

  try {
    const result = await registerUser(parsed.data.email.toLowerCase(), parsed.data.password, parsed.data.name);
    response.status(201).json(result);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'Email already registered' });
      return;
    }
    response.status(500).json({ error: 'Unable to register user' });
  }
});

authRouter.post('/login', loginRateLimit, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Valid email and password are required' });
    return;
  }

  try {
    response.json(await loginUser(parsed.data.email.toLowerCase(), parsed.data.password));
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
      response.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    response.status(500).json({ error: 'Unable to login' });
  }
});
