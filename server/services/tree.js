
import { getDb } from '../utils/db.js';

export async function getPagesTree(lang='vi'){
  const db = await getDb();
  const rows = await db.all(`
    SELECT p.id, p.parent_id, p.order_index, p.status, t.title, t.slug, t.full_path
    FROM pages p
    LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language = ?
    WHERE p.deleted_at IS NULL
    ORDER BY COALESCE(p.parent_id,0), p.order_index, p.id
  `, lang);
  return buildTree(rows);
}

export async function getCategoriesTree(lang='vi'){
  const db = await getDb();
  const rows = await db.all(`
    SELECT c.id, c.parent_id, c.order_index, t.name as title, t.slug, t.full_path
    FROM categories c
    LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(c.parent_id,0), c.order_index, c.id
  `, lang);
  return buildTree(rows);
}

function buildTree(rows){
  const byId = new Map();
  rows.forEach(r=>{ r.children=[]; byId.set(r.id, r); });
  const roots = [];
  rows.forEach(r=>{
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(r);
    else roots.push(r);
  });
  return roots;
}
