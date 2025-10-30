<!-- public/js/editor.js -->
<script>
(function(){
  function getCsrf(){
    const m=document.querySelector('meta[name="csrf-token"]');
    return m?m.content:'';
  }

  // ========== Quill ==========
  function initQuillIfExists(){
    const el = document.querySelector('[data-quill-editor]');
    if(!el) return;
    const hidden = document.querySelector('textarea[name="content_html"]');
    const toolbar = [
      [{ 'header': [2,3,4,false] }],
      ['bold','italic','underline','strike'],
      [{ 'align': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link','blockquote','code'],
      ['clean'],
      ['image','video']
    ];
    const quill = new Quill(el, { theme:'snow', modules: { toolbar } });

    if (hidden && hidden.value) {
      const div=document.createElement('div'); div.innerHTML=hidden.value;
      quill.root.innerHTML=div.innerHTML;
    }
    const form = el.closest('form');
    if (form) form.addEventListener('submit', ()=>{ if(hidden){ hidden.value = quill.root.innerHTML; } });

    // Nút chèn ảnh vào nội dung
    const btn = document.querySelector('[data-insert-media]');
    if(btn){
      btn.addEventListener('click', async ()=>{
        const chosen = await openMediaPicker({ multi:false });
        if(!chosen || !chosen.length) return;
        const { url } = chosen[0];
        const range = quill.getSelection(true) || { index: quill.getLength() };
        quill.insertEmbed(range.index, 'image', url, Quill.sources.USER);
      });
    }
  }

  // ========== Media Picker ==========
  // options: { multi: boolean }
  async function openMediaPicker(options={ multi:false }){
    // Lấy danh sách media
    const r = await fetch('/admin/media/list', { headers: { 'Accept': 'application/json' } });
    const { items=[] } = await r.json();

    // UI tạm thời: prompt (0..n) hoặc upload mới
    let message = 'Nhập chỉ số ảnh muốn chọn (0..n). Để trống = Upload mới.\n';
    message += items.map((m,i)=> `${i}: ${m.original_filename} (${m.mime_type})`).join('\n');
    if(options.multi) message += '\n\nCó thể nhập nhiều chỉ số, cách nhau bởi dấu phẩy (VD: 0,2,5)';

    const choice = window.prompt(message, '');
    if (choice===null) return []; // cancel

    // Upload mới?
    if (choice.trim()==='') {
      const fileInput=document.createElement('input'); fileInput.type='file'; 
      fileInput.multiple = !!options.multi;
      fileInput.accept='image/*,.svg';
      return await new Promise(resolve=>{
        fileInput.onchange=async function(){
          const files=[...fileInput.files];
          const results=[];
          for(const f of files){
            const fd=new FormData(); fd.append('file', f);
            const up = await fetch('/admin/media/upload', { method:'POST', body: fd, headers:{ 'CSRF-Token': getCsrf() } });
            const info = await up.json(); // {id,url,...}
            results.push(info);
          }
          resolve(results);
        };
        fileInput.click();
      });
    }

    // Chọn từ danh sách sẵn có
    const indexes = options.multi 
      ? choice.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n))
      : [parseInt(choice,10)];

    const picked=[];
    for(const i of indexes){
      if(i>=0 && i<items.length){
        picked.push(items[i]); // {id,url,original_filename,...}
      }
    }
    return picked;
  }

  // ========== Featured Image & Gallery ==========
  function initFeaturedAndGallery(){
    // Featured
    const btnFeat = document.querySelector('[data-pick-featured]');
    const inpFeat = document.querySelector('input[name="featured_media_id"]');
    const prevFeat = document.querySelector('[data-preview-featured]');
    if (btnFeat && inpFeat && prevFeat){
      btnFeat.addEventListener('click', async ()=>{
        const chosen = await openMediaPicker({ multi:false });
        if(!chosen || !chosen.length) return;
        inpFeat.value = chosen[0].id;
        prevFeat.innerHTML = `<img src="${chosen[0].url}" style="max-width:100%;height:120px;object-fit:contain">`;
      });
    }

    // Gallery
    const btnGal = document.querySelector('[data-pick-gallery]');
    const inpGal = document.querySelector('input[name="gallery_ids"]');
    const wrapGal = document.querySelector('[data-preview-gallery]');
    if (btnGal && inpGal && wrapGal){
      btnGal.addEventListener('click', async ()=>{
        const chosen = await openMediaPicker({ multi:true });
        if(!chosen || !chosen.length) return;
        // merge với những gì đã có
        const already = (inpGal.value||'').split(',').map(s=>parseInt(s,10)).filter(n=>!isNaN(n));
        const ids = [...already, ...chosen.map(x=>x.id)];
        // de-dup
        const uniq = Array.from(new Set(ids));
        inpGal.value = uniq.join(',');
        renderGalleryPreview(uniq, wrapGal);
      });

      // Render lần đầu nếu có sẵn dữ liệu
      if (inpGal.value){
        const ids = inpGal.value.split(',').map(s=>parseInt(s,10)).filter(n=>!isNaN(n));
        renderGalleryPreview(ids, wrapGal);
      }
    }
  }

  async function renderGalleryPreview(ids, container){
    container.innerHTML = '';
    if(!ids.length) return;
    // Lấy list rồi map id -> url
    const r = await fetch('/admin/media/list', { headers: { 'Accept': 'application/json' }});
    const { items=[] } = await r.json();
    const map = new Map(items.map(m=>[m.id, m.url]));
    container.innerHTML = ids.map(id=>{
      const url = map.get(id);
      if(!url) return '';
      return `<div class="mr-2 mb-2 d-inline-block">
        <img src="${url}" style="width:100px;height:100px;object-fit:cover;border:1px solid #eee">
      </div>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', function(){
    initQuillIfExists();
    initFeaturedAndGallery();
  });
})();
</script>
