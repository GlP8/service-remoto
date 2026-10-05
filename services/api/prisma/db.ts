import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './schema.d';
import contractJson from './schema.json' with { type: 'json' };
import { env } from '../src/config/env.js';

export const db = postgres<Contract>({
  contractJson,
  url: env.DATABASE_URL,
});
