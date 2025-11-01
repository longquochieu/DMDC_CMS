// public/js/dnd-tree.js
(function () {
  function getCsrf() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function initTree(container) {
    if (!container) return;

    var treeType = container.getAttribute('data-tree'); // 'pages' | 'categories'
    var lang = container.getAttribute('data-lang') || 'vi';

    // 🔧 Hỗ trợ đủ mọi ID root có thể xuất hiện trong markup
    var root =
      container.querySelector('#pages-tree-root, #page-tree-root, #cat-tree-root, #categories-tree-root') ||
      container.querySelector('ul');

    if (!root) return;

    let draggingLi = null;

    // Gắn draggable cho mọi handle trong cây
    root.querySelectorAll('.draggable-handle').forEach(function (handle) {
      var li = handle.closest('li');
      if (!li) return;

      handle.setAttribute('draggable', 'true');

      handle.addEventListener('dragstart', function (e) {
        draggingLi = li;
        try { e.dataTransfer.setData('text/plain', li.getAttribute('data-node-id') || ''); } catch (_) {}
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(function () { li.classList.add('opacity-50'); }, 0);
      });

      handle.addEventListener('dragend', function () {
        if (draggingLi) draggingLi.classList.remove('opacity-50');
        draggingLi = null;
        root.querySelectorAll('.drop-target').forEach(function (el) { el.classList.remove('drop-target'); });
      });
    });

    root.addEventListener('dragenter', function (e) {
      if (!draggingLi) return;
      var li = e.target.closest('li');
      if (!li || li === draggingLi) return;
      li.classList.add('drop-target');
    });

    root.addEventListener('dragover', function (e) {
      if (!draggingLi) return;
      var li = e.target.closest('li');
      if (!li || li === draggingLi) return;
      e.preventDefault(); // bắt buộc để nhận 'drop'
    });

    root.addEventListener('dragleave', function (e) {
      var li = e.target.closest('li');
      if (li) li.classList.remove('drop-target');
    });

    root.addEventListener('drop', function (e) {
      if (!draggingLi) return;
      e.preventDefault();

      var targetHandle = e.target.closest('.draggable-handle');
      var targetLi = targetHandle ? targetHandle.closest('li') : e.target.closest('li');
      if (!targetLi || targetLi === draggingLi) return;

      var dropOnTitle = !!targetHandle;

      if (dropOnTitle) {
        // Thả lên tiêu đề → đổi CHA: trở thành con của targetLi
        var childUl = targetLi.querySelector(':scope > ul');
        if (!childUl) {
          childUl = document.createElement('ul');
          childUl.className = 'list-group list-group-flush ms-4 mt-2';
          targetLi.appendChild(childUl);
        }
        childUl.appendChild(draggingLi);
        persistOrder(draggingLi, targetLi, null);
      } else {
        // Thả vào phần khác → đổi THỨ TỰ cùng cấp
        targetLi.parentElement.insertBefore(draggingLi, targetLi);
        var parentLi = targetLi.closest('li'); // null nếu ở root
        var index = indexOfLi(draggingLi);
        persistOrder(draggingLi, parentLi, index);
      }

      draggingLi.classList.remove('opacity-50');
      root.querySelectorAll('.drop-target').forEach(function (el) { el.classList.remove('drop-target'); });
      draggingLi = null;
    });

    function indexOfLi(li) {
      var siblings = Array.from(li.parentElement.children).filter(function (x) { return x.tagName === 'LI'; });
      return siblings.indexOf(li);
    }

    function computeNewParentId(parentLi) {
      return parentLi ? parentLi.getAttribute('data-node-id') : null;
    }

    function persistOrder(movedLi, parentLi, explicitIndex) {
      var nodeId = movedLi.getAttribute('data-node-id');
      var newParentId = computeNewParentId(parentLi);

      var listContainer = parentLi
        ? parentLi.querySelector(':scope > ul')
        : movedLi.parentElement;

      var liSiblings = Array.from(listContainer.children).filter(function (x) { return x.tagName === 'LI'; });

      var newIndex = explicitIndex;
      if (newIndex == null) newIndex = liSiblings.indexOf(movedLi);

      fetch(`/admin/${treeType}/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': getCsrf()
        },
        body: JSON.stringify({
          node_id: nodeId,
          new_parent_id: newParentId,
          new_index: newIndex,
          lang: lang
        })
      })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || 'Reorder failed'); });
      })
      .catch(function (err) {
        console.error(err);
        alert('Không lưu được thứ tự. Trang sẽ tải lại.');
        location.reload();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-tree]').forEach(initTree);
  });
})();
