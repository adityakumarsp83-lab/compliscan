import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import pool from './db.js';
import type { Request, Response, NextFunction } from 'express';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured for a hosted backend');
}
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const TOKEN_EXPIRY = '24h';

export type UserRole = 'INSPECTOR' | 'ADMIN';

export interface JWTPayload {
  userId: string;
  role: UserRole;
  name: string;
  inspectorId: string;
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JWTPayload;
  } catch {
    return null;
  }
}

// Express middleware — attaches user to req if valid token present
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token expired or invalid' });
    return;
  }

  if (process.env.DATABASE_URL) {
    try {
      const result = await pool.query('SELECT username, role, full_name, inspector_id FROM users WHERE username=$1', [payload.userId]);
      const account = result.rows[0];
      if (!account) { res.status(401).json({ error: 'Account no longer available' }); return; }
      payload.role = account.role; payload.name = account.full_name; payload.inspectorId = account.inspector_id;
    } catch { res.status(503).json({ error: 'Cannot verify account; try again when connected' }); return; }
  }
  (req as any).user = payload;
  next();
}

// Middleware factory for role-gating
export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user as JWTPayload | undefined;
    if (!user || user.role !== role) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
