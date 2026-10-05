import { Router } from 'express';
import bcrypt from 'bcrypt';
import { generateToken } from '../authMiddleware.js';
import pool from '../db.js';

const router = Router();

/**
 * POST /api/auth/signup
 * Body: { username, password, fullName, inspectorId }
 */
router.post('/signup', async (req, res) => {
  const { username, password, fullName, inspectorId } = req.body;

  if (!username || !password || !fullName || !inspectorId) {
    res.status(400).json({ error: 'All fields are required' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Check if Neon is configured
    if (!process.env.DATABASE_URL) {
      res.status(500).json({ error: 'Database not configured' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, full_name, inspector_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, passwordHash, 'INSPECTOR', fullName, inspectorId]
    );

    const token = generateToken({
      userId: username,
      role: 'INSPECTOR',
      name: fullName,
      inspectorId,
    });

    res.status(201).json({
      token,
      user: {
        userId: username,
        role: 'INSPECTOR',
        name: fullName,
        inspectorId,
      }
    });

  } catch (err: any) {
    console.error('Signup error:', err);
    if (err.code === '23505') { // unique constraint violation
      res.status(409).json({ error: 'Username or Inspector ID already exists' });
    } else {
      res.status(500).json({ error: err.message || 'Error creating user' });
    }
  }
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  try {
    if (!process.env.DATABASE_URL) {
      res.status(500).json({ error: 'Database not configured. Cannot login.' });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const userRow = result.rows[0];
    const match = await bcrypt.compare(password, userRow.password_hash);
    if (!match) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = generateToken({
      userId: userRow.username,
      role: userRow.role,
      name: userRow.full_name,
      inspectorId: userRow.inspector_id,
    });

    res.json({
      token,
      user: {
        userId: userRow.username,
        role: userRow.role,
        name: userRow.full_name,
        inspectorId: userRow.inspector_id,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Internal server error during login' });
  }
});

/**
 * POST /api/auth/verify
 */
router.post('/verify', (req, res) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  try {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    res.json({
      valid: true,
      user: {
        name: payload.name,
        role: payload.role,
        inspectorId: payload.inspectorId,
        userId: payload.userId,
      },
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
