// scripts/seed-db.js  (ESM)
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cms.sqlite');

const seedsDir = path.join(__dirname, '..', 'seeds');
if (!fs.existsSync(seedsDir)) {
  console.log('No seeds directory found, nothing to do.');
  process.exit(0);
}

const files = fs.readdirSync(seedsDir)
  .filter(f => f.toLowerCase().endsWith('.sql'))
  .sort();

// Thử ưu tiên better-sqlite3; nếu không có thì dùng sqlite3
let useBetter = false;
try {
  await import('better-sqlite3');
  useBetter = true;
} catch {}

if (useBetter) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);

  db.exec('BEGIN');
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(seedsDir, f), 'utf8');
      console.log('Running seed:', f);
      db.exec(sql);
    }
    db.exec('COMMIT');
    console.log('Seeding completed.');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Seeding failed:', e.message);
    process.exit(1);
  } finally {
    db.close();
  }

} else {
  const { default: sqlite3pkg } = await import('sqlite3');
  const sqlite3 = sqlite3pkg.verbose();
  const db = new sqlite3.Database(DB_PATH);

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN');
      try {
        for (const f of files) {
          const sql = fs.readFileSync(path.join(seedsDir, f), 'utf8');
          console.log('Running seed:', f);
          db.exec(sql);
        }
        db.run('COMMIT', (err) => (err ? reject(err) : resolve()));
      } catch (e) {
        db.run('ROLLBACK', () => reject(e));
      }
    });
  }).then(() => {
    console.log('Seeding completed.');
  }).catch((e) => {
    console.error('Seeding failed:', e.message);
    process.exit(1);
  }).finally(() => {
    db.close();
  });
}
