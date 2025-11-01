// public/js/dnd-tree.js
(function () {
  function getCsrf() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function initTree(container) {
    if (!container || container.dataset.dndInitialized === "1") return;
    container.dataset.dndInitialized = "1";

    var treeType = container.getAttribute('data-tree'); // 'pages' | 'categories'
    var lang = container.getAttribute('data-lang') || 'vi';

    // ưu tiên UL trực tiếp trong container
    var root = container.querySelector(':scope > ul');
    if (!root) {
      // fallback theo id cũ hoặc bất kỳ ul nào
      root = container.querySelector('ul#cat-tree-root, ul#page-tree-root') || container.querySelector('ul');
    }
    if (!root) return;

    // Helper
    function isDescendant(ancestorLi, maybeChildLi) {
      if (!ancestorLi || !maybeChildLi) return false;
      return ancestorLi !== maybeChildLi && ancestorLi.contains(maybeChildLi);
    }

    function indexOfLi(li) {
      const siblings = Array.from(li.parentElement.children).filter(x => x.tagName === 'LI');
      return siblings.indexOf(li);
    }

    function computeNewParentId(parentLi) {
      if (!parentLi) return null;
      return parentLi.getAttribute('data-node-id') || null;
    }

    let draggingLi = null;

    // Gắn draggable cho tất cả handle
    root.querySelectorAll('li .draggable-handle').forEach(handle => {
      const li = handle.closest('li');
      if (!li) return;

      handle.setAttribute('draggable', 'true');

      handle.addEventListener('dragstart', function (e) {
        draggingLi = li;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox cần dataTransfer.setData để bật drag
        try { e.dataTransfer.setData('text/plain', li.getAttribute('data-node-id') || ''); } catch(_){}
        setTimeout(() => li.classList.add('opacity-50'), 0);
      });

      handle.addEventListener('dragend', function () {
        if (draggingLi) draggingLi.classList.remove('opacity-50');
        draggingLi = null;
        root.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      });
    });

    // Drag over
    root.addEventListener('dragover', function (e) {
      if (!draggingLi) return;
      const targetHandle = e.target.closest('.draggable-handle');
      const targetLi = targetHandle ? targetHandle.closest('li') : e.target.closest('li');
      if (!targetLi || targetLi === draggingLi) return;

      // không cho thả vào chính con cháu của node đang kéo
      if (isDescendant(draggingLi, targetLi)) return;

      e.preventDefault();
      targetLi.classList.add('drop-target');
    });

    root.addEventListener('dragleave', function (e) {
      const li = e.target.closest('li');
      if (li) li.classList.remove('drop-target');
    });

    // Drop
    root.addEventListener('drop', function (e) {
      if (!draggingLi) return;
      e.preventDefault();

      const targetHandle = e.target.closest('.draggable-handle');
      const targetLi = targetHandle ? targetHandle.closest('li') : e.target.closest('li');
      if (!targetLi || targetLi === draggingLi) return;

      // chặn cycle
      if (isDescendant(draggingLi, targetLi)) return;

      // thả lên tiêu đề → đổi cha (append vào ul con)
      // thả vào vùng khác của li → đổi thứ tự cùng cấp (insertBefore)
      const dropOnTitle = !!targetHandle;

      if (dropOnTitle) {
        let ul = targetLi.querySelector(':scope > ul');
        if (!ul) {
          ul = document.createElement('ul');
          ul.className = 'list-unstyled ms-4 mt-1';
          targetLi.appendChild(ul);
        }
        ul.appendChild(draggingLi);

        const parentId = computeNewParentId(targetLi);
        const liSiblings = Array.from(ul.children).filter(x => x.tagName === 'LI');
        const newIndex = liSiblings.indexOf(draggingLi);
        persistOrder(draggingLi, parentId, newIndex);
      } else {
        // cùng cấp: chèn trước targetLi
        const parentLi = targetLi.parentElement.closest('li') || null; // null = root
        targetLi.parentElement.insertBefore(draggingLi, targetLi);

        const siblingsUl = parentLi ? parentLi.querySelector(':scope > ul') : root;
        const liSiblings = Array.from(siblingsUl.children).filter(x => x.tagName === 'LI');
        const newIndex = liSiblings.indexOf(draggingLi);
        const parentId = computeNewParentId(parentLi);
        persistOrder(draggingLi, parentId, newIndex);
      }

      draggingLi.classList.remove('opacity-50');
      root.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      draggingLi = null;
    });

    function persistOrder(movedLi, newParentId, newIndex) {
      const nodeId = movedLi.getAttribute('data-node-id');

      fetch(`/admin/${treeType}/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': getCsrf()
        },
        body: JSON.stringify({
          node_id: nodeId,
          new_parent_id: newParentId, // null hoặc id
          new_index: newIndex,
          lang: lang
        })
      })
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(t || 'Reorder failed'); });
        return r.json();
      })
      .catch(err => {
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
