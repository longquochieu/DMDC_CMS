
(function(){
  function getCsrf(){ var m=document.querySelector('meta[name="csrf-token"]'); return m?m.content:''; }
  function toast(msg){ if(window.$ && $.toast){ $.toast(msg); } else { console.log('[toast]', msg); } }

  function makeSortableList(root, endpoint, lang){
    var lists = root.querySelectorAll('ul.tree-level');
    lists.forEach(function(ul){
      new Sortable(ul, {
        group: 'nested',
        animation: 150,
        handle: '.drag-handle',
        fallbackOnBody: true,
        swapThreshold: 0.65,
        onEnd: function (evt) {
          var el = evt.item;
          var nodeId = el.getAttribute('data-id');
          var parentLi = el.parentElement.closest('li[data-id]');
          var newParentId = parentLi ? parentLi.getAttribute('data-id') : '';
          var newIndex = Array.prototype.indexOf.call(el.parentElement.children, el);
          var payload = { node_id: nodeId, new_parent_id: newParentId || null, new_index: newIndex, lang: lang };
          fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json','CSRF-Token': getCsrf() }, body: JSON.stringify(payload) })
            .then(r=>{ if(!r.ok) return r.text().then(t=>{throw new Error(t||('HTTP '+r.status))}); return r.json(); })
            .then(data=>{
              toast('Đã lưu thứ tự');
              if (data && data.updated_paths) {
                Object.keys(data.updated_paths).forEach(function(id){
                  var li = root.querySelector('li[data-id="'+id+'"]');
                  if(!li) return;
                  var fp = li.querySelector('[data-full-path]');
                  if(fp) fp.textContent = data.updated_paths[id];
                });
              }
            })
            .catch(err=>{ console.error('Reorder error:', err); alert('Lỗi sắp xếp: '+err.message); window.location.reload(); });
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    var tree = document.querySelector('[data-tree="pages"]');
    if (tree) makeSortableList(tree, '/admin/pages/reorder', tree.getAttribute('data-lang')||'vi');
    var tree2 = document.querySelector('[data-tree="categories"]');
    if (tree2) makeSortableList(tree2, '/admin/categories/reorder', tree2.getAttribute('data-lang')||'vi');
  });
})();
