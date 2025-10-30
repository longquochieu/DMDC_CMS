(function(){
  function toSlug(s){
    return (s||'').toString().normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g,'')
      .trim()
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-');
  }
  document.addEventListener('DOMContentLoaded', function(){
    var title = document.querySelector('[data-field=title]');
    var slug  = document.querySelector('[data-field=slug]');
    if (title && slug){
      var edited = false;
      slug.addEventListener('input', function(){ edited = true; });
      title.addEventListener('input', function(){
        if (!edited) slug.value = toSlug(title.value);
      });
    }
  });
})();
