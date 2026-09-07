import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../authMiddleware.js';
import type { JWTPayload } from '../authMiddleware.js';
import pool from '../db.js';

const router = Router();

export interface InspectionRecord {
  id: string;
  timestamp: string;
  product_name: string;
  barcode: string;
  score: string;
  passed: number;
  total: number;
  raw_text: string;
  tokens_json: string;
  report_json: string;
  image_thumbnail: string;
  inspector_id: string;
  inspector_name: string;
  location: string;
}

/**
 * POST /api/history
 */
router.post('/', authMiddleware, async (req, res) => {
  const user = (req as any).user as JWTPayload;
  const body = req.body as Omit<InspectionRecord, 'id' | 'inspector_id' | 'inspector_name'>;

  if (!body.report_json) {
    res.status(400).json({ error: 'report_json is required' });
    return;
  }

  const record: InspectionRecord = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    product_name: body.product_name || 'Unknown Product',
    barcode: body.barcode || '',
    score: body.score || '0/0',
    passed: body.passed || 0,
    total: body.total || 0,
    raw_text: body.raw_text || '',
    tokens_json: body.tokens_json || '{}',
    report_json: body.report_json,
    image_thumbnail: body.image_thumbnail || '',
    inspector_id: user.inspectorId,
    inspector_name: user.name,
    location: body.location || '',
  };

  try {
    if (!process.env.DATABASE_URL) throw new Error('DB not configured');
    
    await pool.query(
      `INSERT INTO inspections (id, timestamp, product_name, barcode, score, passed, total, raw_text, tokens_json, report_json, image_thumbnail, inspector_id, inspector_name, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        record.id, record.timestamp, record.product_name, record.barcode, record.score,
        record.passed, record.total, record.raw_text, record.tokens_json, record.report_json,
        record.image_thumbnail, record.inspector_id, record.inspector_name, record.location
      ]
    );

    res.status(201).json({ id: record.id, message: 'Inspection saved' });
  } catch (err: any) {
    console.error('Error saving inspection:', err.message);
    res.status(500).json({ error: 'Failed to save inspection' });
  }
});

/**
 * GET /api/history
 */
router.get('/', authMiddleware, async (req, res) => {
  const user = (req as any).user as JWTPayload;
  const { search, barcode, from, to, page = '1', limit = '20' } = req.query as Record<string, string>;

  try {
    if (!process.env.DATABASE_URL) throw new Error('DB not configured');

    let query = 'SELECT id, timestamp, product_name, barcode, score, passed, total, image_thumbnail, inspector_id, inspector_name, location FROM inspections WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Role filtering
    if (user.role !== 'ADMIN') {
      query += ` AND inspector_id = $${paramIndex++}`;
      params.push(user.inspectorId);
    }

    if (search) {
      query += ` AND (product_name ILIKE $${paramIndex} OR barcode ILIKE $${paramIndex} OR inspector_id ILIKE $${paramIndex} OR location ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (barcode) {
      query += ` AND barcode = $${paramIndex++}`;
      params.push(barcode);
    }

    if (from) {
      query += ` AND timestamp >= $${paramIndex++}`;
      params.push(from);
    }

    if (to) {
      query += ` AND timestamp <= $${paramIndex++}`;
      params.push(to);
    }

    const countQuery = `SELECT COUNT(*) FROM (${query}) AS subquery`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    params.push(limitNum, (pageNum - 1) * limitNum);

    const result = await pool.query(query, params);
    
    const listView = result.rows.map((row) => ({
      ...row,
      has_image: !!row.image_thumbnail && row.image_thumbnail.length > 0,
    }));

    res.json({
      data: listView,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err: any) {
    console.error('Error fetching history:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /api/history/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as JWTPayload;

  try {
    if (!process.env.DATABASE_URL) throw new Error('DB not configured');

    const result = await pool.query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    const record = result.rows[0];

    if (user.role !== 'ADMIN' && record.inspector_id !== user.inspectorId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(record);
  } catch (err: any) {
    console.error('Error fetching inspection:', err.message);
    res.status(500).json({ error: 'Failed to fetch inspection' });
  }
});

/**
 * DELETE /api/history/:id
 */
router.delete('/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DB not configured');
    
    const result = await pool.query('DELETE FROM inspections WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    res.json({ message: 'Inspection deleted' });
  } catch (err: any) {
    console.error('Error deleting inspection:', err.message);
    res.status(500).json({ error: 'Failed to delete inspection' });
  }
});

export default router;
