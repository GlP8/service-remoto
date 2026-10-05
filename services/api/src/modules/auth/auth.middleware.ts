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

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: env.JWT_AUDIENCE,
      issuer: env.JWT_ISSUER,
    }) as jwt.JwtPayload;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0 || !isUserRole(payload.role)) {
      throw new Error('Invalid token');
    }
    request.userId = userId;
    request.userRole = payload.role;
    next();
  } catch {
    response.status(401).json({ error: 'Invalid token' });
  }
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
