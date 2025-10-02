

// referencing.js — shared helpers for building references from HTML
// Centralizes refMap pattern loading, cite→refId mapping, and DOM extraction

const fs = require('fs');
const path = require('path');

// ---- refMap pattern loading / normalization ----

// ---- Master Reference Index (MRI) helpers ----
const MRI_PATH = path.resolve(process.cwd(), 'src/main/reports/masterReferenceIndex.json');
let _mri = null;
let _dirty = false;

function _initEmptyMRI() {
  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    stats: { uniqueRefIds: 0, totalSightings: 0 },
    refs: {},
    reverse: {},
    orphans: { unmapped: [] }
  };
}

function _stableSort(arr, keyFn) {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ka = keyFn(a.v);
      const kb = keyFn(b.v);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.i - b.i;
    })
    .map(x => x.v);
}

function _loadMRI() {
  if (_mri) return _mri;
  try {
    if (fs.existsSync(MRI_PATH)) {
      const raw = fs.readFileSync(MRI_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      _mri = parsed && typeof parsed === 'object' ? parsed : _initEmptyMRI();
    } else {
      // ensure folder exists
      fs.mkdirSync(path.dirname(MRI_PATH), { recursive: true });
      _mri = _initEmptyMRI();
    }
  } catch {
    _mri = _initEmptyMRI();
  }
  return _mri;
}

function _ensureRef(refId) {
  const mri = _loadMRI();
  if (!mri.refs[refId]) {
    mri.refs[refId] = {
      refId,
      normalized: null,
      resolution: null,
      provenance: { firstSeen: null, mapSource: [], mapDetails: [] },
      rawVariants: []
    };
  }
  return mri.refs[refId];
}

function _dedupeVariants(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    const key = [
      r.docId,
      r.type,
      (r.cite || '').trim(),
      (r.href || '').trim(),
      (r.rawRef || '').trim(),
      (r.title || '').trim()
    ].join('||');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function _dedupeStrings(arr) {
  const s = new Set();
  const out = [];
  for (const v of arr) {
    if (!s.has(v)) {
      s.add(v);
      out.push(v);
    }
  }
  return out;
}

function mriRecordSighting({ docId, type, refId, cite, href, mapSource, mapDetail, rawRef, title }) {
  const mri = _loadMRI();
  const ts = new Date().toISOString();

  _dirty = true;

  if (refId) {
    const entry = _ensureRef(refId);
    // provenance
    entry.provenance.firstSeen = entry.provenance.firstSeen || ts;
    if (mapSource) {
      entry.provenance.mapSource = _dedupeStrings([...(entry.provenance.mapSource || []), String(mapSource)]);
    }
    if (mapDetail) {
      const details = [...(entry.provenance.mapDetails || []), String(mapDetail)];
      entry.provenance.mapDetails = _dedupeStrings(details);
    }
    // variants (now include rawRef + title)
    entry.rawVariants = _dedupeVariants([
      ...(entry.rawVariants || []),
      { docId, type, cite, href, rawRef, title }
    ]);
  } else {
    // orphan
    mri.orphans = mri.orphans || { unmapped: [] };
    const orphan = { docId, type, cite, href, rawRef, title };
    const key = JSON.stringify(orphan);
    const exists = (mri.orphans.unmapped || []).some(x => JSON.stringify(x) === key);
    if (!exists) {
      (mri.orphans.unmapped ||= []).push(orphan);
    }
  }

  // stats
  const keys = Object.keys(mri.refs);
  mri.stats.uniqueRefIds = keys.length;
  mri.stats.totalSightings = (mri.stats.totalSightings || 0) + 1;
  mri.generatedAt = ts;
}

function mriFlush(opts = {}) {
  const { force = false } = opts;
  const mri = _loadMRI();
  const fileExists = fs.existsSync(MRI_PATH);
  const shouldWrite = force || _dirty || !fileExists;

  if (!shouldWrite) {
    return { path: MRI_PATH, wrote: false, reason: 'unchanged', uniqueRefIds: Object.keys(mri.refs || {}).length, orphanCount: (mri.orphans?.unmapped || []).length };
  }

  // Sort keys/arrays for stable diffs
  const sortedRefsKeys = Object.keys(mri.refs || {}).sort();
  const refsOut = {};
  for (const k of sortedRefsKeys) {
    const e = mri.refs[k];
    const sortedVariants = _stableSort(e.rawVariants || [], v => `${v.docId}||${v.type}||${(v.cite || '').toLowerCase()}`);
    const sortedMapSource = (e.provenance?.mapSource || []).slice().sort();
    const sortedMapDetails = (e.provenance?.mapDetails || []).slice(); // keep order (capped)
    refsOut[k] = {
      refId: e.refId,
      normalized: e.normalized || null,
      resolution: e.resolution || null,
      provenance: {
        firstSeen: e.provenance?.firstSeen || null,
        mapSource: sortedMapSource.length ? sortedMapSource : undefined,
        mapDetails: sortedMapDetails.length ? sortedMapDetails : undefined
      },
      rawVariants: sortedVariants.length ? sortedVariants : undefined
    };
  }
  const out = {
    version: mri.version || '1.0.0',
    generatedAt: mri.generatedAt || new Date().toISOString(),
    stats: mri.stats || { uniqueRefIds: Object.keys(refsOut).length, totalSightings: 0 },
    refs: refsOut,
    reverse: mri.reverse || {},
    orphans: {
      unmapped: (mri.orphans?.unmapped || []).slice(0, 200)
    }
  };
  if (shouldWrite) {
    out.generatedAt = new Date().toISOString();
  }
  fs.mkdirSync(path.dirname(MRI_PATH), { recursive: true });
  fs.writeFileSync(MRI_PATH, JSON.stringify(out, null, 2) + '\n');

  _dirty = false;
  return { path: MRI_PATH, wrote: true, uniqueRefIds: Object.keys(refsOut).length, orphanCount: out.orphans.unmapped.length };
}

function mriEnsureFile() {
  // Will write if file is missing; otherwise no-op thanks to dirty guard
  return mriFlush({ force: false });
}
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
function mapRefByCiteDiag(text) {
  if (!text) return { refId: null, mapSource: null, mapDetail: null };
  const idx = _lazyLoadPatternIndex();
  const raw = String(text);
  const norm = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  // plain first
  for (const p of idx) {
    if (p.type === 'plain' && p.key === norm) {
      return { refId: p.refId, mapSource: 'plain', mapDetail: `=${norm}` };
    }
  }
  // regex next
  for (const p of idx) {
    if (p.type === 'regex') {
      try {
        if (p.re.test(raw)) return { refId: p.refId, mapSource: 'regex', mapDetail: p.re.toString() };
      } catch {}
    }
  }
  return { refId: null, mapSource: null, mapDetail: null };
}

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
function parseRefId(text, href = '', opts = {}) {
  const wantDiag = !!opts.wantDiag;
  // allow explicit cite→refId normalization via refMap.json
  const diag = mapRefByCiteDiag(text);
  if (diag.refId) return wantDiag ? { refId: diag.refId, diag } : diag.refId;

  // W3C dated REC
  if (/w3\.org\/TR\/\d{4}\/REC-([^\/]+)-(\d{8})\//i.test(href)) {
    const [, shortname, yyyymmdd] = href.match(/REC-([^\/]+)-(\d{8})/i);
    { const refId = `W3C.${shortname}.${yyyymmdd}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'w3c:dated-REC' } } : refId; }
  }
  // W3C undated shortname
  if (/w3\.org\/TR\/([^\/]+)\/?$/i.test(href)) {
    const [, shortname] = href.match(/w3\.org\/TR\/([^\/]+)\/?$/i);
    { const refId = `W3C.${shortname}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'w3c:shortname' } } : refId; }
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
        { const refId = `${lineage}.${suffix}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'smpte-designator' } } : refId; }
      }
      { const refId = `${lineage}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'smpte-designator' } } : refId; }
    }
  }

  // RFC
  if (/RFC\s*(\d+)/i.test(text)) {
    { const refId = `RFC${text.match(/RFC\s*(\d+)/i)[1]}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'rfc-number' } } : refId; }
  }

  // NIST via DOI href
  if (/10\.6028\/NIST\.(.+)/i.test(href)) {
    const [, id] = href.match(/10\.6028\/NIST\.(.+)/i);
    { const refId = `NIST.${id}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'nist-doi' } } : refId; }
  }
  // NIST FIPS (strip optional PUB)
  if (/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i.test(text)) {
    const [, num, rev] = text.match(/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i);
    { const refId = `NIST.FIPS.${num}${rev || ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'nist-fips' } } : refId; }
  }
  // FIPS structure in hrefs .../fips/186/2/...
  if (/csrc\.nist\.gov\/.+\/fips\/(\d+)(?:\/(\d+))?/i.test(href)) {
    const m = href.match(/fips\/(\d+)(?:\/(\d+))?/i);
    const num = m[1];
    const rev = m[2] ? `-${m[2]}` : '';
    { const refId = `NIST.FIPS.${num}${rev}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'nist-fips-path' } } : refId; }
  }

  // ISO/IEC family — capture the highest year present, if any
  if (/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `ISO.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }
  if (/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `ISO.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }
  if (/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `IEC.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }

  return wantDiag ? { refId: null, diag: { mapSource: null, mapDetail: null } } : null;
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
      // Collect rawRef (entire LI text) and title (text between <cite> and <a>)
      const rawRef = $(el).text().replace(/\s+/g, ' ').trim();
      const $clone = $(el).clone();
      const citeOnly = $clone.find('cite').text() || '';
      $clone.find('a').remove();
      $clone.find('cite').remove();
      let midText = $clone.text().replace(/\s+/g, ' ').trim();
      // Drop leading comma/space and any trailing "url: ..." segment
      midText = midText.replace(/^,?\s*/, '').replace(/\burl:\s*.*$/i, '').trim();
      const titleText = midText || null;
      const parsed = parseRefId(refText, href, { wantDiag: true });
      const refId = parsed && parsed.refId ? parsed.refId : null;
      if (refId) {
        if (Array.isArray(refId)) {
          for (const r of refId) {
            list.push(r);
            mriRecordSighting({
              docId: currentDocId,
              type: s.key,
              refId: r,
              cite: refText,
              href,
              mapSource: parsed.diag?.mapSource,
              mapDetail: parsed.diag?.mapDetail,
              rawRef,
              title: titleText
            });
          }
        } else {
          list.push(refId);
          mriRecordSighting({
            docId: currentDocId,
            type: s.key,
            refId,
            cite: refText,
            href,
            mapSource: parsed.diag?.mapSource,
            mapDetail: parsed.diag?.mapDetail,
            rawRef,
            title: titleText
          });
        }
      } else {
        out.badRefs.push({ docId: currentDocId, type: s.key, refText, href });
        mriRecordSighting({
          docId: currentDocId,
          type: s.key,
          refId: null,
          cite: refText,
          href,
          mapSource: null,
          mapDetail: null,
          rawRef,
          title: titleText
        });
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
  reloadRefMap,
  // MRI helpers
  mriRecordSighting,
  mriFlush,
  mriEnsureFile
};