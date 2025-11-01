// server/services/category_tree.js
import { getDb } from "../utils/db.js";

/**
 * Trả về cây danh mục theo ngôn ngữ:
 * Mỗi node: { id, title, slug, parent_id, order_index, children: [] }
 */
export async function getCategoriesTree(language = "vi") {
  const db = await getDb();
  const rows = await db.all(
    `
    SELECT
      c.id,
      c.parent_id,
      COALESCE(c.order_index, 0) AS order_index,
      ct.name  AS title,
      ct.slug  AS slug
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(c.order_index, 0), c.id
  `,
    language
  );

  // Build map & children
  const byId = new Map();
  rows.forEach(r => byId.set(r.id, { ...r, children: [] }));

  const roots = [];
  rows.forEach(r => {
    const node = byId.get(r.id);
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort children theo order_index, id
  const sortKids = arr => {
    arr.sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
    arr.forEach(n => sortKids(n.children));
  };
  sortKids(roots);

  return roots;
}
