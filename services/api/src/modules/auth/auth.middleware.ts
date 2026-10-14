import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export type AuthenticatedRequest = Request & {
  userId?: number;
  userRole?: 'CLIENT' | 'TECHNICIAN' | 'ADMIN';
};

const validRoles = ['CLIENT', 'TECHNICIAN', 'ADMIN'] as const;

function isUserRole(role: unknown): role is typeof validRoles[number] {
  return typeof role === 'string' && validRoles.includes(role as typeof validRoles[number]);
}

export function bearerToken(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export function verifyToken(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: env.JWT_AUDIENCE,
      issuer: env.JWT_ISSUER,
    }) as jwt.JwtPayload;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0 || !isUserRole(payload.role)) return null;
    return { userId, role: payload.role };
  } catch {
    return null;
  }
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const token = bearerToken(request.headers.authorization);

  if (!token) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const identity = verifyToken(token);
  if (!identity) {
    response.status(401).json({ error: 'Invalid token' });
    return;
  }
  request.userId = identity.userId;
  request.userRole = identity.role;
  next();
}

export function requireRole(...roles: NonNullable<AuthenticatedRequest['userRole']>[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.userRole || !roles.includes(request.userRole)) {
      response.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
