import { getDb } from '../server/utils/db.js';
import fs from 'fs';
import path from 'path';

async function run() {
  const db = await getDb();
  const migDir = path.resolve('./migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
    console.log('Running migration:', f);
    await db.exec(sql);
  }
  console.log('Migrations completed.');
  await db.close();
}
run().catch(e => { console.error(e); process.exit(1); });
