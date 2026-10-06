import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pool from '../src/db.js';
const schema = await readFile(new URL('../migrations/001_supervision.sql', import.meta.url), 'utf8');
for (const statement of schema.split(/;\s*\n(?=(?:CREATE|DROP))/)) { if (statement.trim()) await pool.query(statement); }
console.log('Supervision tables and append-only audit functions are ready. Existing inspections were preserved.');
