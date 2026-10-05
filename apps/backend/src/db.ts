import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL || '';
const sql = neon(connectionString, { fullResults: true });

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

const pool = {
  async query<T = any>(queryText: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await (sql as any).query(queryText, params || []);
    return {
      rows: (res.rows || []) as T[],
      rowCount: res.rowCount ?? (res.rows ? res.rows.length : 0),
      command: res.command || '',
    };
  },
};

// Test initial connection
if (connectionString) {
  pool.query('SELECT NOW()')
    .then((result) => {
      console.log('✅ Connected to Neon PostgreSQL Database via HTTPS at', result.rows[0]?.now);
    })
    .catch((err) => {
      console.warn('⚠️ Could not connect to Neon DB:', err?.message || err);
    });
} else {
  console.warn('⚠️ DATABASE_URL not set in environment');
}

export default pool;


