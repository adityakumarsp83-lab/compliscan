import { Router } from 'express';
import { authMiddleware, requireRole } from '../authMiddleware.js';
import { supervisionFlags } from '../inspectionIntegrity.js';
import pool from '../db.js';
const router = Router();
router.use(authMiddleware, requireRole('ADMIN'));
const chainCheck = `event_hash=encode(sha256(convert_to(previous_hash||client_event_id::text||inspection_id::text||actor_username||to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||payload::text,'UTF8')),'hex') AND previous_hash=COALESCE(lag(event_hash) OVER(PARTITION BY inspection_id ORDER BY sequence),'GENESIS')`;
router.get('/legacy', async (_req,res) => {
  try {
    const result = await pool.query('SELECT i.id,i.timestamp,i.product_name,i.score,i.inspector_name,i.inspector_id FROM inspections i WHERE NOT EXISTS(SELECT 1 FROM inspection_events e WHERE e.inspection_id::text=i.id::text) ORDER BY i.timestamp DESC LIMIT 100');
    res.json({ data: result.rows });
  } catch { res.status(503).json({ error: 'Earlier records unavailable' }); }
});
router.get('/inspections', async (_req, res) => {
  try {
    const result = await pool.query(`WITH checked AS (SELECT *, ${chainCheck} AS integrity_valid FROM inspection_events), latest AS (SELECT DISTINCT ON(inspection_id) *, lag(payload) OVER(PARTITION BY inspection_id ORDER BY sequence) AS previous_payload, count(*) OVER(PARTITION BY inspection_id) AS revisions, bool_and(integrity_valid) OVER(PARTITION BY inspection_id) AS chain_valid FROM checked ORDER BY inspection_id,sequence DESC) SELECT latest.*, (SELECT row_to_json(r) FROM inspection_reviews r WHERE r.event_sequence=latest.sequence ORDER BY r.id DESC LIMIT 1) AS review FROM latest ORDER BY received_at DESC LIMIT 500`);
    res.json({ received_at: new Date().toISOString(), data: result.rows.map(row => ({ ...row, flags: [...supervisionFlags(row.payload,row.previous_payload,row.received_at), ...(!row.chain_valid ? ['LEDGER_INTEGRITY_FAILURE'] : [])] })) });
  } catch { res.status(503).json({ error: 'Supervision archive unavailable; retry when connected' }); }
});
router.get('/inspections/:id', async (req,res) => {
  try {
    const result = await pool.query(`SELECT *, ${chainCheck} AS integrity_valid FROM inspection_events WHERE inspection_id=$1 ORDER BY sequence`, [req.params.id]);
    const reviews = await pool.query('SELECT r.* FROM inspection_reviews r JOIN inspection_events e ON e.sequence=r.event_sequence WHERE e.inspection_id=$1 ORDER BY r.id', [req.params.id]);
    res.json({ events: result.rows.map((row,index) => ({ ...row, flags: supervisionFlags(row.payload,result.rows[index-1]?.payload,row.received_at) })), reviews: reviews.rows });
  } catch { res.status(503).json({ error: 'Inspection timeline unavailable' }); }
});
router.post('/reviews', async (req,res) => {
  const { sequence, action, note } = req.body;
  if (!Number.isSafeInteger(Number(sequence)) || !['REVIEWED','ESCALATED'].includes(action) || typeof note !== 'string' || !note.trim() || note.length > 2000) { res.status(400).json({ error: 'Valid revision, action and review note required' }); return; }
  try {
    const result = await pool.query('INSERT INTO inspection_reviews(event_sequence,admin_username,action,note) VALUES($1,$2,$3,$4) RETURNING *', [sequence,(req as any).user.userId,action,note.trim()]);
    res.status(201).json(result.rows[0]);
  } catch { res.status(503).json({ error: 'Review could not be recorded' }); }
});
router.get('/evidence/:sha', async (req,res) => {
  if (!/^[a-f0-9]{64}$/.test(String(req.params.sha))) { res.status(400).json({ error: 'Invalid evidence hash' }); return; }
  try {
    const result = await pool.query("SELECT encode(bytes,'base64') AS encoded, mime_type FROM inspection_evidence WHERE sha256=$1", [req.params.sha]);
    const evidence = result.rows[0];
    if (!evidence) { res.status(404).json({ error: 'Evidence not found' }); return; }
    res.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff').type(evidence.mime_type).send(Buffer.from(evidence.encoded,'base64'));
  } catch { res.status(503).json({ error: 'Original evidence unavailable' }); }
});
export default router;
