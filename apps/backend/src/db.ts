import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test the connection
pool.connect((err, client, release) => {
  if (err) {
    console.warn('⚠️  Could not connect to Neon DB. Check DATABASE_URL in .env');
    return;
  }
  if (client) {
    client.query('SELECT NOW()', (err, result) => {
      release();
      if (err) {
        return console.warn('⚠️  Error executing query', err.stack);
      }
      console.log('✅ Connected to Neon PostgreSQL Database at', result.rows[0].now);
    });
  }
});

export default pool;
