import pino from 'pino';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const LOG_DIR = process.env.LOG_DIR || './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const transport = pino.transport({
  targets: [
    { target: 'pino-pretty', options: { colorize: true }, level: 'info' },
    { target: 'pino/file', options: { destination: `${LOG_DIR}/error.log` }, level: 'error' }
  ]
});
const logger = pino({ level: 'info' }, transport);
export default logger;
