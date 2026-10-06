import 'dotenv/config';
import pool from '../src/db.js';
const username = process.argv[2];
if (!username) throw new Error('Usage: npm run admin:grant -- EXISTING_USERNAME');
const result = await pool.query("UPDATE users SET role='ADMIN' WHERE username=$1 RETURNING username", [username]);
if (!result.rows.length) throw new Error('Account does not exist. Register the account first.');
console.log(`Admin access granted to ${result.rows[0].username}. Sign out and sign in again.`);
