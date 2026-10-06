import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../authMiddleware.js';
import { normalizeInspection } from '../inspectionIntegrity.js';
import pool from '../db.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 8 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 } });
router.use(authMiddleware);
router.post('/', upload.array('photos', 5), async (req, res) => {
  let normalized;
  try { normalized = normalizeInspection(req.body, (req as any).user, (req.files || []) as Express.Multer.File[]); }
  catch (error: any) { res.status(400).json({ error: error.message || 'Invalid inspection' }); return; }
  try {
    const result = await pool.query('SELECT * FROM append_inspection_event($1::uuid,$2::uuid,$3,$4::jsonb,$5::jsonb)',
      [req.body.client_event_id, req.body.id, (req as any).user.userId, JSON.stringify(normalized.payload), JSON.stringify(normalized.photos)]);
    const event = result.rows[0];
    res.status(201).json({ id: event.inspection_id, event_id: event.client_event_id, sequence: event.sequence, received_at: event.received_at, event_hash: event.event_hash });
  } catch (error: any) {
    const conflict = /another account|reused with changed|duplicate key/.test(error.message);
    res.status(conflict ? 409 : 503).json({ error: conflict ? 'Inspection or event belongs to another submission; contact an administrator' : 'Central archive unavailable; keep the inspection queued and retry' });
  }
});
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await pool.query(`SELECT DISTINCT ON(inspection_id) payload FROM inspection_events WHERE ($1='ADMIN' OR actor_username=$2) ORDER BY inspection_id,sequence DESC`, [user.role,user.userId]);
    const data = result.rows.map(row => row.payload).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
    res.json({ data, pagination: { total: data.length } });
  } catch { res.status(503).json({ error: 'Central archive unavailable' }); }
});
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inspection_events WHERE inspection_id=$1 ORDER BY sequence DESC LIMIT 1', [req.params.id]);
    const event = result.rows[0];
    if (!event) { res.status(404).json({ error: 'Inspection not found' }); return; }
    if ((req as any).user.role !== 'ADMIN' && event.actor_username !== (req as any).user.userId) { res.status(403).json({ error: 'Access denied' }); return; }
    res.json(event.payload);
  } catch { res.status(503).json({ error: 'Central archive unavailable' }); }
});
router.delete('/:id', (_req, res) => res.status(405).json({ error: 'Central evidence is append-only; deletion is disabled' }));
export default router;
