import { getDb } from '../utils/db.js';

export async function buildFullPathForPage(pageId, language) {
  const db = await getDb();
  const segs = [];
  let current = await db.get('SELECT p.id, p.parent_id, t.slug FROM pages p JOIN pages_translations t ON t.page_id = p.id AND t.language=? WHERE p.id=?', language, pageId);
  if (!current) return null;
  segs.unshift(current.slug);
  while (current.parent_id) {
    current = await db.get('SELECT p.id, p.parent_id, t.slug FROM pages p JOIN pages_translations t ON t.page_id = p.id AND t.language=? WHERE p.id=?', language, current.parent_id);
    if (!current) break;
    segs.unshift(current.slug);
  }
  return '/' + segs.join('/');
}

export async function buildFullPathForCategory(categoryId, language) {
  const db = await getDb();
  const segs = [];
  let current = await db.get('SELECT c.id, c.parent_id, t.slug FROM categories c JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.id=?', language, categoryId);
  if (!current) return null;
  segs.unshift(current.slug);
  while (current.parent_id) {
    current = await db.get('SELECT c.id, c.parent_id, t.slug FROM categories c JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.id=?', language, current.parent_id);
    if (!current) break;
    segs.unshift(current.slug);
  }
  return '/' + segs.join('/');
}
