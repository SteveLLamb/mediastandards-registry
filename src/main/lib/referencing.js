

// referencing.js — shared helpers for building references from HTML
// Centralizes refMap pattern loading, cite→refId mapping, and DOM extraction

const fs = require('fs');
const path = require('path');

// ---- refMap pattern loading / normalization ----
let _patternIndex = null;
let _refMapLoadError = null;

function _normalizePatterns(val) {
  if (Array.isArray(val)) return val.filter(v => typeof v === 'string' && v.trim().length > 0);
  if (typeof val === 'string' && val.trim().length > 0) return [val];
  return [];
}

function _buildPatternIndex(refMap) {
  const out = [];
  if (!refMap || typeof refMap !== 'object') return out;
  const byCitePatterns = refMap.byCitePatterns || {};
  for (const [refId, patternsVal] of Object.entries(byCitePatterns)) {
    const patterns = _normalizePatterns(patternsVal);
    if (!patterns.length) continue;
    for (const pat of patterns) {
      const m = pat.match(/^\s*\/(.*)\/([a-z]*)\s*$/i);
      if (m) {
        const body = m[1];
        const flags = m[2] || 'i';
        try { out.push({ type: 'regex', re: new RegExp(body, flags), refId }); } catch {/* ignore bad regex */}
      } else {
        const key = String(pat).replace(/\s+/g, ' ').trim().toLowerCase();
        if (key) out.push({ type: 'plain', key, refId });
      }
    }
  }
  return out;
}

function _lazyLoadPatternIndex() {
  if (_patternIndex) return _patternIndex;
  try {
    const refMapPath = path.resolve(process.cwd(), 'src/main/input/refMap.json');
    const raw = fs.readFileSync(refMapPath, 'utf-8');
    const refMap = JSON.parse(raw);
    _patternIndex = _buildPatternIndex(refMap);
  } catch (e) {
    _refMapLoadError = e;
    _patternIndex = [];
  }
  return _patternIndex;
}

function reloadRefMap() {
  _patternIndex = null;
  _refMapLoadError = null;
  return _lazyLoadPatternIndex();
}

// ---- cite→refId helpers ----
function mapRefByCite(text) {
  if (!text) return null;
  const idx = _lazyLoadPatternIndex();
  const norm = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  // 1) plain exact matches first (normalized)
  for (const p of idx) {
    if (p.type === 'plain' && p.key === norm) return p.refId;
  }
  // 2) regex patterns
  for (const p of idx) {
    if (p.type === 'regex') { try { if (p.re.test(text)) return p.refId; } catch {} }
  }
  return null;
}

// Main parser: derive a canonical refId from a citation text + optional href
function parseRefId(text, href = '') {
  // allow explicit cite→refId normalization via refMap.json
  const mapped = mapRefByCite(text);
  if (mapped) return mapped;

  // W3C dated REC
  if (/w3\.org\/TR\/\d{4}\/REC-([^\/]+)-(\d{8})\//i.test(href)) {
    const [, shortname, yyyymmdd] = href.match(/REC-([^\/]+)-(\d{8})/i);
    return `W3C.${shortname}.${yyyymmdd}`;
  }
  // W3C undated shortname
  if (/w3\.org\/TR\/([^\/]+)\/?$/i.test(href)) {
    const [, shortname] = href.match(/w3\.org\/TR\/([^\/]+)\/?$/i);
    return `W3C.${shortname}`;
  }

  // Handle multi-part cite strings split by '|', prefer ISO/IEC slice if present
  const parts = String(text).split('|').map(p => p.trim());
  text = parts.find(p => /ISO\/IEC|ISO/.test(p)) || parts[0];

  // SMPTE (ST/RP/RDD/EG/AG/OV), optional part, optional year[:YYYY or YYYY-MM]
  {
    const smpteRe = /SMPTE\s+(ST|RP|RDD|EG|AG|OV)[\s\u00A0\u2010-\u2015\-]+(\d+[A-Za-z]?)(?:-(\d+))?(?::\s*(\d{4})(?:-(\d{2}))?)?/i;
    const m = text.match(smpteRe);
    if (m) {
      const [, type, numRaw, part, year, month] = m;
      const num = String(numRaw).toUpperCase();
      const lineage = `SMPTE.${type.toUpperCase()}${part ? `${num}-${part}` : num}`;
      if (year) {
        const y = parseInt(year, 10);
        const suffix = (y >= 2023 && month) ? `${year}-${month}` : year;
        return `${lineage}.${suffix}`;
      }
      return `${lineage}`;
    }
  }

  // RFC
  if (/RFC\s*(\d+)/i.test(text)) {
    return `RFC${text.match(/RFC\s*(\d+)/i)[1]}`;
  }

  // NIST via DOI href
  if (/10\.6028\/NIST\.(.+)/i.test(href)) {
    const [, id] = href.match(/10\.6028\/NIST\.(.+)/i);
    return `NIST.${id}`;
  }
  // NIST FIPS (strip optional PUB)
  if (/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i.test(text)) {
    const [, num, rev] = text.match(/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i);
    return `NIST.FIPS.${num}${rev || ''}`;
  }
  // FIPS structure in hrefs .../fips/186/2/...
  if (/csrc\.nist\.gov\/.+\/fips\/(\d+)(?:\/(\d+))?/i.test(href)) {
    const m = href.match(/fips\/(\d+)(?:\/(\d+))?/i);
    const num = m[1];
    const rev = m[2] ? `-${m[2]}` : '';
    return `NIST.FIPS.${num}${rev}`;
  }

  // ISO/IEC family — capture the highest year present, if any
  if (/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `ISO.${base}${year ? `.${year}` : ''}`;
  }
  if (/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `ISO.${base}${year ? `.${year}` : ''}`;
  }
  if (/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `IEC.${base}${year ? `.${year}` : ''}`;
  }

  return null;
}

// Extract references from a cheerio-loaded doc
// Returns: { references: {normative?, bibliographic?}, badRefs: [...] }
function extractRefs($, currentDocId) {
  const out = { references: {}, badRefs: [] };
  const sections = [
    { id: 'normative-references', key: 'normative' },
    { id: 'bibliography', key: 'bibliographic' }
    // W3C occasionally uses 'informative-references'; add here if needed
  ];

  for (const s of sections) {
    const list = [];
    $(`#sec-${s.id} ul li`).each((_, el) => {
      const cite = $(el).find('cite');
      const refText = cite.text();
      const href = $(el).find('a.ext-ref').attr('href') || '';
      const refId = parseRefId(refText, href);
      if (refId) {
        if (Array.isArray(refId)) list.push(...refId); else list.push(refId);
      } else {
        out.badRefs.push({ docId: currentDocId, type: s.key, refText, href });
      }
    });
    if (list.length > 0) out.references[s.key] = list;
  }
  return out;
}

module.exports = {
  mapRefByCite,
  parseRefId,
  extractRefs,
  reloadRefMap
};