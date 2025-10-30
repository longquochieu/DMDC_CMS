// public/js/pages-tree.js
(function(){
  function getCsrf(){
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }
  function postJSON(url, data){
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'CSRF-Token': getCsrf()
      },
      body: JSON.stringify(data)
    }).then(r=>{
      if (!r.ok) return r.json().catch(()=>({})).then(j=>{ throw new Error(j.error || r.statusText); });
      return r.json();
    });
  }

  function initTreeDnD(){
    var root = document.getElementById('pages-tree-root');
    if (!root) return;
    var lang = root.getAttribute('data-lang') || 'vi';

    // Mỗi <ul class="children"> là một "container" chứa các <li.tree-node>
    var containers = root.querySelectorAll('ul.children');
    containers.forEach(function(ul){
      new Sortable(ul, {
        group: 'pages-tree',
        animation: 120,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        handle: '.node-handle',
        onEnd: function(evt){
          try {
            var item = evt.item;                      // <li.tree-node>
            var nodeId = item.getAttribute('data-id');
            var newParentUl = item.parentElement;     // <ul.children>
            var newParentId = newParentUl.getAttribute('data-parent-id') || null;

            // index của item trong danh sách ul hiện tại
            var newIndex = Array.prototype.indexOf.call(newParentUl.children, item);

            postJSON('/admin/pages/reorder', {
              node_id: nodeId,
              new_parent_id: newParentId,
              new_index: newIndex,
              lang: lang
            }).then(function(resp){
              // thành công – không cần làm gì thêm
              // console.log('reordered', resp);
            }).catch(function(err){
              alert('Reorder lỗi: ' + err.message);
              window.location.reload();
            });
          } catch(e){
            alert('Reorder lỗi: ' + e.message);
            window.location.reload();
          }
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', initTreeDnD);
})();
