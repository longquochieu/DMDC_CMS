
// server/utils/sanitizeSvg.js
import sanitizeHtml from 'sanitize-html';

export function sanitizeSvg(svgString){
  return sanitizeHtml(svgString, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['svg','path','g','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','stop','use','title','desc','clipPath','mask']),
    allowedAttributes: {
      svg: ['width','height','viewBox','fill','stroke','stroke-width','xmlns','preserveAspectRatio'],
      '*': ['d','x','y','cx','cy','r','rx','ry','x1','y1','x2','y2','points','transform','fill','stroke','stroke-width','opacity','class','id']
    },
    allowedSchemes: [ 'data' ],
    allowedSchemesAppliedToAttributes: [ 'xlink:href', 'href' ],
    selfClosing: sanitizeHtml.defaults.selfClosing.concat(['path','circle','ellipse','line','polyline','polygon']),
    enforceHtmlBoundary: false
  });
}
