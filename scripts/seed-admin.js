import { getDb } from '../server/utils/db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

function randomPassword(len=12){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let out=''; for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

async function run(){
  const db = await getDb();
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@domain.com';
  const exists = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', username, email);
  const pass = randomPassword(14);
  const hash = await bcrypt.hash(pass, 10);
  if (!exists){
    await db.run(`INSERT INTO users(username,email,password_hash,role,status,created_at,updated_at)
                  VALUES(?,?,?,?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                username,email,hash,'admin');
    console.log('Admin created:', username, email);
  } else {
    await db.run('UPDATE users SET password_hash=? WHERE id=?', hash, exists.id);
    console.log('Admin password reset for:', username);
  }
  fs.mkdirSync('./logs', { recursive: true });
  fs.writeFileSync('./logs/admin_password.txt', pass);
  console.log('Temporary admin password:', pass);
  await db.close();
}
run().catch(e=>{ console.error(e); process.exit(1); });
