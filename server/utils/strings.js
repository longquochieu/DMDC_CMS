import slugify from 'slugify';

export function toSlug(text) {
  return slugify(text || '', { lower: true, strict: true, locale: 'vi' });
}

export function buildFullPath(segments) {
  // segments: array of slugs from root to current
  return '/' + segments.filter(Boolean).join('/');
}
