export function sanitizeSvg(svg){
  return (svg||'').replace(/<script[\s\S]*?<\/script>/gi,'')
                  .replace(/on[a-z]+\s*=\s*["'][^"']*["']/gi,'');
}
