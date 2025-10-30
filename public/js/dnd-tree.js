// public/js/dnd-tree.js
(function(){
  const meta = document.querySelector('[data-tree]');
  if (!meta) return;
  const type = meta.getAttribute('data-tree');
  const lang = meta.getAttribute('data-lang') || 'vi';

  // Dùng SortableJS hoặc HTML5 drag tự code — ở đây đơn giản hoá:
  // Giả định bạn đã gắn sẵn HTML có thể drag; khi thả, ta gửi thứ tự + parent.

  async function reorder(payload){
    const url = type === 'pages' ? '/admin/pages/reorder' : '/admin/categories/reorder';
    const res = await window.csrfFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, moves: payload })
    });
    if (!res.ok) {
      const t = await res.text();
      alert('Reorder lỗi: ' + t);
    } else {
      location.reload();
    }
  }

  // Demo handler: bạn tự gắn vào thư viện drag/drop bạn dùng,
  // Khi thả xong, gọi reorder([...]) với mỗi move: {id, parent_id, order_index}
  window._demoReorder = reorder; // để test tạm
})();
