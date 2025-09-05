const PREFIX_RE = /^10\.\d{4,9}(?:\.\d+)?/; // RFC 3986-compatible
function doiPrefix(doi) {
  if (typeof doi !== 'string') return null;
  const m = doi.trim().toLowerCase().match(PREFIX_RE);
  return m ? m[0] : null;
}
module.exports = { doiPrefix };

// 1a) DOI prefix → Crossref publisher fallback
if (d && typeof d.doi === 'string') {
  const { doiPrefix } = require('./utils/dois'); // adjust path to your layout
  const pfx = doiPrefix(d.doi);
  if (pfx && CROSSREF_PREFIX_MAP[pfx]) {
    return CROSSREF_PREFIX_MAP[pfx].toUpperCase();
  }
}