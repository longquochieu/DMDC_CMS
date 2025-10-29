import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
dotenv.config();

const DB_PATH = process.env.DB_PATH || './data/dmdc.sqlite';

export async function getDb() {
  return open({ filename: DB_PATH, driver: sqlite3.Database });
}
