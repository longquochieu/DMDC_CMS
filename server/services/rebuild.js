
import { getDb } from '../utils/db.js';

export async function rebuildPageSubtreeFullPaths(rootId, language='vi'){
  const db = await getDb();
  const queue = [rootId];
  const updated = {};
  while(queue.length){
    const id = queue.shift();
    // compose full path
    const segs = [];
    let cur = id;
    while(cur){
      const r = await db.get(`SELECT p.id, p.parent_id, t.slug FROM pages p JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.id=?`, language, cur);
      if (!r) break;
      segs.unshift(r.slug);
      cur = r.parent_id;
    }
    const full = '/' + segs.join('/');
    await db.run('UPDATE pages_translations SET full_path=? WHERE page_id=? AND language=?', full, id, language);
    updated[id] = full;
    const children = await db.all('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL ORDER BY order_index, id', id);
    for (const c of children) queue.push(c.id);
  }
  return updated;
}

export async function rebuildCategorySubtreeFullPaths(rootId, language='vi'){
  const db = await getDb();
  const queue = [rootId];
  const updated = {};
  while(queue.length){
    const id = queue.shift();
    const segs = [];
    let cur = id;
    while(cur){
      const r = await db.get(`SELECT c.id, c.parent_id, t.slug FROM categories c JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.id=?`, language, cur);
      if (!r) break;
      segs.unshift(r.slug);
      cur = r.parent_id;
    }
    const full = '/' + segs.join('/');
    await db.run('UPDATE categories_translations SET full_path=? WHERE category_id=? AND language=?', full, id, language);
    updated[id] = full;
    const children = await db.all('SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL ORDER BY order_index, id', id);
    for (const c of children) queue.push(c.id);
  }
  return updated;
}
