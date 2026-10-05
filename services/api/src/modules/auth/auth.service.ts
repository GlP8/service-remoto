import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../infrastructure/database/pool.js';
import { env } from '../../config/env.js';

type UserRecord = {
  id: number;
  email: string;
  name: string | null;
  role: 'CLIENT' | 'TECHNICIAN' | 'ADMIN';
  passwordHash: string;
};

const publicUser = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

const tokenFor = (user: UserRecord) => {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    audience: env.JWT_AUDIENCE,
    expiresIn: '1d',
    issuer: env.JWT_ISSUER,
  });
};

const diagnosticConsentVersion = env.DIAGNOSTIC_CONSENT_VERSION;

export async function registerUser(email: string, password: string, name?: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query<UserRecord>(
    `INSERT INTO "user" (email, "passwordHash", name, "diagnosticConsentAt", "diagnosticConsentVersion", "updatedAt")
     VALUES ($1, $2, $3, now(), $4, now())
     RETURNING id, email, name, role, "passwordHash"`,
    [email, passwordHash, name ?? null, diagnosticConsentVersion],
  );
  const user = result.rows[0];

  return { user: publicUser(user), token: tokenFor(user) };
}

export async function loginUser(email: string, password: string) {
  const result = await pool.query<UserRecord>(
    `SELECT id, email, name, role, "passwordHash"
     FROM "user" WHERE email = $1`,
    [email],
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error('INVALID_CREDENTIALS');
  }

  return { user: publicUser(user), token: tokenFor(user) };
}
