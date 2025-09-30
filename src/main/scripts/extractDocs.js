/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const axios = require('axios');
const { resolveUrlAndInject, urlReachable } = require('./url.resolve.js');
const { getPrLogPath } = require('./utils/prLogPath');
const { logSmart, heartbeat } = require('./utils/logSmart');
const prLogPath = getPrLogPath();
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');

// Optional reference normalization via patterns (patterns-only, no byCite exact map)
let refMap = {};
try {
  refMap = require('../input/refMap.json');
} catch (_) {
  refMap = {};
}

// byCitePatterns maps *refId* → pattern(s)
// A pattern can be:
//   - plain string (normalized exact match: collapse spaces, trim, lowercase)
//   - regex written as "/.../flags"
// Values can be a single pattern string or an array of patterns.
function normalizePatterns(val) {
  if (Array.isArray(val)) return val.filter(v => typeof v === 'string' && v.trim().length > 0);
  if (typeof val === 'string' && val.trim().length > 0) return [val];
  return [];
}

const refMapPatterns = [];
if (refMap && refMap.byCitePatterns && typeof refMap.byCitePatterns === 'object') {
  for (const [refId, patternsVal] of Object.entries(refMap.byCitePatterns)) {
    const patterns = normalizePatterns(patternsVal);
    if (!patterns.length) continue;
    for (const pat of patterns) {
      const m = pat.match(/^\s*\/(.*)\/([a-z]*)\s*$/i);
      if (m) {
        const body = m[1];
        const flags = m[2] || 'i';
        try {
          refMapPatterns.push({ type: 'regex', re: new RegExp(body, flags), refId });
        } catch (_) { /* ignore bad regex */ }
      } else {
        const key = String(pat).replace(/\s+/g, ' ').trim().toLowerCase();
        if (key) refMapPatterns.push({ type: 'plain', key, refId });
      }
    }
  }
}

function mapRefByCite(text) {
  if (!text) return null;
  const norm = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  // 1) plain exact matches first (normalized)
  for (const p of refMapPatterns) {
    if (p.type === 'plain' && p.key === norm) return p.refId;
  }
  // 2) regex patterns
  for (const p of refMapPatterns) {
    if (p.type === 'regex') {
      try { if (p.re.test(text)) return p.refId; } catch (_) {}
    }
  }
  return null;
}

// Normalize titles by removing a leading "SMPTE" token (and common punctuation/spaces)
function stripLeadingSmpte(title) {
  if (!title) return title;
  return String(title).replace(/^\s*SMPTE\s*[:\-–—]?\s*/i, '').trim();
}

const typeMap = {
        AG: 'Administrative Guideline',
        OM: 'Operations Manual',
        ST: 'Standard',
        RP: 'Recommended Practice',
        EG: 'Engineering Guideline',
        RDD: 'Registered Disclosure Document',
        OV: 'Overview Document'
      };

// === FILTERING FUNCTION ===
const FILTER_ENABLED = true; // false = process all
const filterList = require('../input/filterList.smpte.json');
const suiteMap = new Map();

// --- Seed URL helpers ---
function normalizeSeedUrl(u) {
  try {
    // Force https and strip query/hash
    const url = new URL(u);
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    let s = url.toString();
    // Ensure trailing slash for consistency with discovery URLs
    if (!s.endsWith('/')) s += '/';
    return s;
  } catch (_) {
    return u; // leave untouched if not a valid URL string
  }
}

function shouldFilterUrl(url) {
  if (!FILTER_ENABLED) return false;
  // Reuse filterList semantics: exact match or prefix match
  for (const f of filterList) {
    if (f === url) return true;
    if (url.startsWith(f)) return true;
    // If a suite URL is present in filterList and we know its children, treat as filtered
    if (suiteMap.has(f)) {
      const children = suiteMap.get(f) || [];
      if (children.some(child => child === url || url.startsWith(child))) return true;
    }
  }
  return false;
}

function printUrlsSuiteWithChildren(label, urls) {
  if (!urls.length) return;

  console.groupCollapsed(`${label}: ${urls.length}  (Suites: ${urls.filter(u => suiteMap.has(u)).length}, Docs: ${urls.filter(u => !suiteMap.has(u)).length})`);

  const printed = new Set();

  const emit = (url, list) => {
    const isSuite = suiteMap.has(url);
    let reason = '';
    for (const [suiteUrl, children] of suiteMap.entries()) {
      if (children.includes(url)) {
        reason = ` (Doc within ${label.toLowerCase().includes('queued') ? 'queued' : 'filtered'} suite: ${suiteUrl})`;
        break;
      }
    }
    console.log(`    - ${url}${isSuite ? ' [SUITE]' : ''}${reason}`);
    printed.add(url);
  };

  for (const url of urls) {
    if (printed.has(url)) continue;

    if (suiteMap.has(url)) {
      // Suite: print it and then its children (skip if already printed)
      emit(url, urls);
      const children = suiteMap.get(url) || [];
      for (const child of children) {
        if (urls.includes(child) && !printed.has(child)) {
          emit(child, urls);
        }
      }
    } else {
      // If this is a child of a suite in the same list, skip here — it will print after the suite
      let skip = false;
      for (const [suiteUrl, children] of suiteMap.entries()) {
        if (children.includes(url) && urls.includes(suiteUrl)) {
          skip = true;
          break;
        }
      }
      if (!skip) emit(url, urls);
    }
  }

  console.groupEnd();
}

function filterDiscoveredDocs(allDocs) {
  const queued = []; 
  const filtered = [];

  for (const { url: docUrl, suite } of allDocs) {
    if (!FILTER_ENABLED) {
      queued.push(docUrl);
      continue;
    }

    const inList = filterList.some(f => {
      if (f === docUrl) return true;
      if (suite && f === suite) return true;
      if (docUrl.startsWith(f)) return true;
      return false;
    });

    if (inList) filtered.push(docUrl);
    else queued.push(docUrl);
  }

  if (FILTER_ENABLED) {
    const filteredSuites = filterList.filter(f => suiteMap.has(f));
    for (const suiteUrl of filteredSuites) {
      const children = suiteMap.get(suiteUrl) || [];
      for (const childUrl of children) {
        if (!filtered.includes(childUrl) && queued.includes(childUrl)) {
          filtered.push(childUrl);
          const idx = queued.indexOf(childUrl);
          if (idx !== -1) queued.splice(idx, 1);
        }
      }
    }
  }

  const suiteCount = allDocs.filter(d => suiteMap.has(d.url)).length;
  const docCount = allDocs.length - suiteCount;
  console.log(`\n\n📊 Discovery Filtering Stats (URLs):`);
  console.log(`  Total found: ${allDocs.length}  (Suites: ${suiteCount}, Docs: ${docCount})`);
  printUrlsSuiteWithChildren('  Queued', queued);
  printUrlsSuiteWithChildren('  Filtered', filtered);

  return queued;
}

// === MAIN DISCOVERY ===
async function discoverFromRootDocPage() {
  const rootUrl = 'https://pub.smpte.org/doc/';
  console.log(`\n🔍 Fetching SMPTE root doc list: ${rootUrl}`);

  const res = await axios.get(rootUrl);
  const $ = cheerio.load(res.data);

  let allDocs = [];

  const topLevel = [];
  $('li.doc > div > a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && href.startsWith('/doc/')) {
      topLevel.push(new URL(href, rootUrl).href);
    }
  });

  for (const url of topLevel) {
    try {
      const page = await axios.get(url);
      const $page = cheerio.load(page.data);

      if ($page('ul.versions').length) {
        // Direct doc page
        console.log(`📄 DOC: ${url}`);
        allDocs.push({ url, suite: null });
      } else if ($page('ul.docs').length) {
        // Suite page – map suite to children
        console.log(`📚 SUITE: ${url}`);
        const children = [];
        $page('ul.docs li.doc a').each((i, el) => {
          const href = $page(el).attr('href');
          if (href && href.startsWith('/doc/')) {
            const childUrl = new URL(href, rootUrl).href;
            console.log(`   ↳ Found doc in suite: ${childUrl}`);
            children.push(childUrl);
            allDocs.push({ url: childUrl, suite: url });
          }
        });
        suiteMap.set(url, children);
        allDocs.push({ url, suite: null });
      } else {
        console.log(`❓ UNKNOWN TYPE: ${url}`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to inspect ${url}: ${err.message}`);
    }
  }

  console.log(`🔍 Discovered ${allDocs.length} doc URLs from root (after suite expansion)`);

  // Apply filtering and return only the URL strings
  const docsToProcess = filterDiscoveredDocs(allDocs);
  return docsToProcess;
}

async function urlExistsNoRedirect(url) {
  try {
    const res = await axios.head(url, { maxRedirects: 0, validateStatus: null });
    return res.status === 200;
  } catch {
    return false;
  }
}

const metaConfig = {
  parsed: {
    docNumber: { confidence: 'high', note: 'Parsed from HTML pubNumber meta tag' },
    docPart: { confidence: 'high', note: 'Parsed from HTML pubPart meta tag' },
    docTitle: { confidence: 'high', note: 'Concatenated suite title and publication title' },
    docType: { confidence: 'high', note: 'Publication type parsed from HTML' },
    group: { confidence: 'high', note: 'Working group parsed from HTML pubTC meta tag' },
    publicationDate: { confidence: 'high', note: 'Parsed from HTML pubDateTime meta tag' },
    releaseTag: { confidence: 'high', note: 'Release tag parsed from URL folder structure' },
    publisher: { confidence: 'high', note: 'Parsed from HTML publisher meta tag' },
    'status.stage': { confidence: 'high', note: 'Stage parsed from HTML pubStage meta tag' },
    'status.state': { confidence: 'high', note: 'State parsed from HTML pubState meta tag' },
    'status.amended': { confidence: 'high', note: 'Parsed from wrapper #amendments' },
    'status.amendedBy': { confidence: 'high', note: 'Parsed from wrapper #amendment' },
    'status.stabilized': { confidence: 'high', note: 'Parsed from wrapper #state' },
    'status.withdrawn': { confidence: 'high', note: 'Parsed from wrapper #state' },
    'status.withdrawnNotice': { confidence: 'high', note: 'Parsed from wrapper #withdrawal-statement' },
    references: { confidence: 'high', note: 'Parsed from HTML references sections' },
    revisionOf: { confidence: 'high', note: 'Parsed from HTML pubRevisionOf meta tag' },
    default: { confidence: 'high', note: 'Extracted directly from HTML' }
  },

  inferred: {
    docNumber: { confidence: 'medium', note: 'Inferred from root folder name' },
    docPart: { confidence: 'medium', note: 'Inferred from root folder name' },
    docTitle: { confidence: 'low', note: 'Unknown in inferred release' },
    docType: { confidence: 'medium', note: 'Inferred from release folder name' },
    group: { confidence: 'low', note: 'Unknown in inferred release' },
    publicationDate: { confidence: 'medium', note: 'Inferred from release folder name' },
    releaseTag: { confidence: 'high', note: 'Release tag inferred from URL folder structure' },
    publisher: { confidence: 'high', note: 'Static: SMPTE' },
    'status.stage': { confidence: 'medium', note: 'Inferred from release folder name' },
    'status.state': { confidence: 'low', note: 'Unknown in inferred release' },
    references: { confidence: 'low', note: 'Unknown in inferred release' },
    revisionOf: { confidence: 'low', note: 'Unknown in inferred releases' },
    default: { confidence: 'medium', note: '' }
  },

  resolved: {
    docId: { confidence: 'high', note: 'Calculated from parsed/inferred metadata' },
    docLabel: { confidence: 'high', note: 'Constructed from parsed/inferred typenumber/number/date' },
    doi: { confidence: 'medium', note: 'Constructed from parsed/inferred type/date' },
    href: { confidence: 'high', note: 'URL generated and verified via redirect resolution' },
    resolvedHref: { confidence: 'high', note: 'Final URL resolved via URL redirect verification' },
    repo: { confidence: 'high', note: 'Calculated from parsed or inferred publication type/number/part and verified to exist' },
    'status.active': { confidence: 'high', note: 'Calculated from the releaseTag(s) and other status values' },
    'status.latestVersion': { confidence: 'high', note: 'Calculated from the releaseTag(s)' },
    'status.superseded': { confidence: 'high', note: 'Calculated from the releaseTag(s)' },
    'status.supersededBy': { confidence: 'high', note: 'Calculated from the releaseTag(s)' },
    'status.supersededDate': { confidence: 'high', note: 'Calculated as the publication date of the next base release (from releaseTag)' },
    default: { confidence: 'high', note: 'Calculated or verified value' }
  },

  manual: {
    default: { confidence: 'medium', note: 'Manually entered value' }
  },

  unknown: {
    default: { confidence: 'unknown', note: 'Source unknown' }
  }
};

const badRefs = [];

function refsAreDifferent(a, b) {
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  if (aSorted.length !== bSorted.length) return true;
  return aSorted.some((val, idx) => val !== bSorted[idx]);
}

function getMetaDefaults(source, field) {
  const srcMap = metaConfig[source] || metaConfig.unknown;
  return srcMap[field] || srcMap[`status.${field}`] || srcMap.default || metaConfig.unknown.default;
}

function injectMeta(doc, field, source, mode, oldValue) {
  const defaults = getMetaDefaults(source, field);
  const meta = {
    source,
    confidence: defaults.confidence,
    note: defaults.note,
    updated: new Date().toISOString(),
    originalValue: oldValue === undefined ? null : oldValue,
    sourceUrl: doc.__sourceUrl
  };
  if (mode === 'update' && oldValue !== undefined && oldValue !== doc[field]) {
    meta.overridden = true;
  }
  doc[`${field}$meta`] = meta;
}

function mdEscape(val) {
  if (val === null || val === undefined) return String(val);
  const s = String(val);
  // Minimal, safe escapes so GitHub won’t parse as Markdown/links
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/#/g, '\\#')
    .replace(/\|/g, '\\|')
    .replace(/!/g, '\\!');
}

function injectMetaForDoc(doc, source, mode, changedFieldsMap = {}) {
  const resolvedFields = ['docId', 'docLabel', 'doi', 'href', 'resolvedHref', 'repo'];
  const resolvedStatusFields = ['active', 'latestVersion', 'superseded'];

  for (const field of Object.keys(doc)) {
    const value = doc[field];
    // Skip $meta fields themselves and any undefined values
    if (field.endsWith('$meta')) continue;
    if (value === undefined) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      const fieldSource = resolvedFields.includes(field) ? 'resolved' : source;
      injectMeta(doc, field, fieldSource, mode, changedFieldsMap[field]);
    }
  }

  if (doc.status && typeof doc.status === 'object') {
    for (const sField of Object.keys(doc.status)) {
      if (sField.endsWith('$meta')) continue;
      const sVal = doc.status[sField];
      if (sVal === undefined || typeof sVal === 'object') continue;
      const fieldSource = resolvedStatusFields.includes(sField) ? 'resolved' : source;
      injectMeta(doc.status, sField, fieldSource, mode, changedFieldsMap[`status.${sField}`]);
    }
  }
}

function inferMetadataFromPath(rootUrl, releaseTag, baseReleases = []) {

  const match = rootUrl.match(/doc\/([^/]+)\/$/);
  const pubTypeNum = match ? match[1].toUpperCase() : null;
  const pubType = pubTypeNum?.match(/^[A-Z]+/)[0];
  const numberPart = pubTypeNum?.replace(pubType, '');
  let docNumber = numberPart;
  let docPart;

  if (numberPart.includes('-')) {
    const [num, part] = numberPart.split('-');
    docNumber = num;
    docPart = part;
  }
  const [datePart] = releaseTag.split('-');
  const pubDate = dayjs(datePart, 'YYYYMMDD');
  const dateString = pubDate.isValid() ? (pubDate.year() < 2023 ? `${pubDate.year()}` : pubDate.format('YYYY-MM')) : 'UNKNOWN';

  let docId = pubTypeNum ? `SMPTE.${pubTypeNum}.${dateString}` : 'UNKNOWN';
  let docLabel = `SMPTE ${pubType || ''} ${docNumber || ''}${docPart ? `-${docPart}` : ''}:${dateString}`;
  let doi = `10.5594/${docId}`;
  let href = `https://doi.org/${doi}`;
  const repoUrl = `https://github.com/SMPTE/${pubTypeNum.toLowerCase()}/`;

  // Amendments
  if (/^(\d{8})-am(\d+)-/.test(releaseTag)) {
    const [, amendDate, amendNum] = releaseTag.match(/^(\d{8})-am(\d+)-/);
    const amendYear = dayjs(amendDate, 'YYYYMMDD').year();
    const base = baseReleases
      .map(tag => ({ tag, date: dayjs(tag.split('-')[0], 'YYYYMMDD') }))
      .filter(entry => entry.date.isValid() && entry.date.isBefore(dayjs(amendDate, 'YYYYMMDD')))
      .sort((a, b) => b.date - a.date)[0];
    if (base) {
      const baseYear = base.date.year();
      docId = `SMPTE.${pubTypeNum}.${baseYear}Am${amendNum}.${amendYear}`;
      docLabel = `SMPTE ${pubType || ''} ${docNumber || ''}${docPart ? `-${docPart}` : ''}:${baseYear} Am${amendNum}:${amendYear}`;
      doi = `10.5594/${docId}`;
      href = `https://doi.org/${doi}`;
    }
  }

  return {
    docId,
    docLabel,
    releaseTag,
    publicationDate: pubDate.isValid() ? pubDate.format('YYYY-MM-DD') : undefined,
    publisher: 'SMPTE',
    href,
    repo: repoUrl,
    doi,
    docType: typeMap[pubType] || pubType,
    docNumber,
    docPart,
    status: {
      active: releaseTag === baseReleases[baseReleases.length - 1],
      latestVersion: releaseTag === baseReleases[baseReleases.length - 1],
      superseded: releaseTag !== baseReleases[baseReleases.length - 1]
    }
  };
}

function mergeInferredInto(existingDoc, inferredDoc) {
  const safeFields = [
    'docId', 
    'releaseTag', 
    'publicationDate', 
    'publisher', 
    'href',
    'repo',
    'doi', 
    'docType', 
    'docNumber', 
    'docPart'
  ];

  for (const key of safeFields) {
    if (inferredDoc[key] !== undefined) {
      existingDoc[key] = inferredDoc[key];
    }
  }

  // Only update known status fields
  if (!existingDoc.status) existingDoc.status = {};
  const statusFields = ['active', 'latestVersion', 'superseded'];
  for (const field of statusFields) {
    if (inferredDoc.status[field] !== undefined) {
      existingDoc.status[field] = inferredDoc.status[field];
    }
  }

}

const parseRefId = (text, href = '') => {
  // allow explicit cite→refId normalization via refMap.json
  const mapped = mapRefByCite(text);
  if (mapped) return mapped;

  if (/w3\.org\/TR\/\d{4}\/REC-([^\/]+)-(\d{8})\//i.test(href)) {
    const [, shortname, yyyymmdd] = href.match(/REC-([^\/]+)-(\d{8})/i);
    return `W3C.${shortname}.${yyyymmdd}`;
  }
  if (/w3\.org\/TR\/([^\/]+)\/?$/i.test(href)) {
    const [, shortname] = href.match(/w3\.org\/TR\/([^\/]+)\/?$/i);
    return `W3C.${shortname}`;
  }
  const parts = text.split('|').map(p => p.trim());
  text = parts.find(p => /ISO\/IEC|ISO/.test(p)) || parts[0];
  // SMPTE refs: support ST/RP/RDD/EG/AG/OV
  // Allow space or hyphen (incl. common Unicode dashes) between type and number
  // Allow optional alpha suffix in the number (e.g., AG-10B)
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
  if (/RFC\s*(\d+)/i.test(text)) {
    return `RFC${text.match(/RFC\s*(\d+)/i)[1]}`;
  }
  if (/10\.6028\/NIST\.(.+)/i.test(href)) {
    const [, id] = href.match(/10\.6028\/NIST\.(.+)/i);
    return `NIST.${id}`;
  }
  // NIST FIPS references (strip optional "PUB" token)
  if (/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i.test(text)) {
    const [, num, rev] = text.match(/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i);
    return `NIST.FIPS.${num}${rev || ''}`;
  }
  // Also recognize FIPS structure in hrefs like .../fips/186/2/...
  if (/csrc\.nist\.gov\/.+\/fips\/(\d+)(?:\/(\d+))?/i.test(href)) {
    const m = href.match(/fips\/(\d+)(?:\/(\d+))?/i);
    const num = m[1];
    const rev = m[2] ? `-${m[2]}` : '';
    return `NIST.FIPS.${num}${rev}`;
  }
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
};

// Extract a single document from a "seed" URL that points directly to a doc page (no release folders).
// Assumes the page hosts an index.html with the same meta structure used by SMPTE doc pages.
const extractFromSeedDoc = async (seedRootUrl) => {
  const rootUrl = seedRootUrl.endsWith('/') ? seedRootUrl : seedRootUrl + '/';
  const indexUrl = rootUrl + 'index.html';
  try {
    const indexRes = await axios.get(indexUrl);
    const $index = cheerio.load(indexRes.data);

    const pubType = $index('[itemprop="pubType"]').attr('content');
    let pubNumber = $index('[itemprop="pubNumber"]').attr('content');
    // Normalize: force any letters in pubNumber to uppercase
    if (pubNumber) pubNumber = pubNumber.replace(/([a-z]+)/g, (m) => m.toUpperCase());
    const pubPart = $index('[itemprop="pubPart"]').attr('content');
    const pubDate = $index('[itemprop="pubDateTime"]').attr('content');
    const suiteTitle = $index('[itemprop="pubSuiteTitle"]').attr('content');
    const title = ($index('title').text() || '').trim();
    const tc = $index('[itemprop="pubTC"]').attr('content');

    const pubDateObj = dayjs(pubDate);
    const dateFormatted = pubDateObj.isValid() ? pubDateObj.format('YYYY-MM-DD') : undefined;
    // Create a synthetic releaseTag from the date (keeps downstream status wiring happy)
    const syntheticTag = pubDateObj.isValid() ? `${pubDateObj.format('YYYYMMDD')}-pub` : '00000000-pub';

    const docType = typeMap[pubType?.toUpperCase()] || pubType;
    let label = `SMPTE ${pubType} ${pubNumber}${pubPart ? `-${pubPart}` : ''}`;
    let id = `SMPTE.${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}`;
    // Special case: OM documents — label fixed to "SMPTE OM" and id maps from title via refMap patterns
    if ((pubType || '').toUpperCase() === 'OM') {
      const rawTitleForMap = (suiteTitle && suiteTitle.trim()) ? suiteTitle : title;
      const normTitleForMap = stripLeadingSmpte(rawTitleForMap);
      const mappedId = mapRefByCite(normTitleForMap) || mapRefByCite(rawTitleForMap);
      if (mappedId) {
        label = 'SMPTE OM';
        id = mappedId;
      }
    }
    const href = rootUrl;
    const pubTypeNum = `${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}`;
    const repoUrl = `https://github.com/SMPTE/${(pubTypeNum || '').toLowerCase()}/`;

    const pubStage = $index('[itemprop="pubStage"]').attr('content');
    const pubState = $index('[itemprop="pubState"]').attr('content');

    const pubPublisher =
      ($index('[itemprop="publisher"]').text() || $index('[itemprop="publisher"]').attr('content') || '').trim() || 'SMPTE';

    // References
    const refSections = { normative: [], bibliographic: [] };
    ['normative-references', 'bibliography'].forEach((sectionId) => {
      const type = sectionId.includes('normative') ? 'normative' : 'bibliographic';
      $index(`#sec-${sectionId} ul li`).each((_, el) => {
        const cite = $index(el).find('cite');
        const refText = cite.text();
        const href = $index(el).find('a.ext-ref').attr('href') || '';
        const refId = parseRefId(refText, href);
        if (refId) {
          if (Array.isArray(refId)) refSections[type].push(...refId);
          else refSections[type].push(refId);
        } else {
          badRefs.push({ docId: id, type, refText, href });
        }
      });
    });

    const revisionRaw = $index('[itemprop="pubRevisionOf"]').attr('content');
    let revisionOf;
    if (revisionRaw) {
      const match = revisionRaw.match(/SMPTE\s+([A-Z]+)\s+(\d+)(?:-(\d+))?:?(\d{4})(?:-(\d{2}))?/);
      if (match) {
        const [, type, number, part, year, month] = match;
        const suffix = (parseInt(year) >= 2023 && month) ? `${year}-${month}` : year;
        const baseId = `SMPTE.${type.toUpperCase()}${part ? `${number}-${part}` : number}.${suffix}`;
        revisionOf = [baseId];
      }
    }

    const doc = {
      docId: id,
      docLabel: label,
      docNumber: pubNumber,
      docPart: pubPart,
      docTitle: `${suiteTitle || ''} ${title}`.trim(),
      docType,
      group: tc ? `smpte-${tc.toLowerCase()}-tc` : undefined,
      publicationDate: dateFormatted,
      releaseTag: syntheticTag,
      publisher: pubPublisher,
      href,
      repo: repoUrl,
      status: {
        active: true,                 // single page represents the latest available view
        latestVersion: true,
        stage: pubStage,
        state: pubState,
        superseded: false
      },
      references: refSections,
      ...(revisionOf && { revisionOf })
    };

    Object.defineProperty(doc, '__sourceUrl', {
      value: rootUrl,
      enumerable: false
    });

    return [doc];
  } catch (err) {
    console.warn(`⚠️ Seed doc parse failed at ${indexUrl}: ${err.message}`);
    return [];
  }
};

const extractFromUrl = async (rootUrl) => {
  const res = await axios.get(rootUrl);
  const $ = cheerio.load(res.data);

  // Collect release folders from the structured versions list, including nested amendments
  const folderLinksSet = new Set();
  const amendmentMap = new Map(); // key: base releaseTag, value: array of amendment releaseTags

  $('ul.versions li.version').each((_, ver) => {
    const $ver = $(ver);

    // 1) Base version link inside this <li.version>
    const baseHrefRaw = $ver.find('> div > a').attr('href') || '';
    const baseHref = baseHrefRaw.trim();
    if (/^\d{8}(?:-am\d+)?-(wd|cd|fcd|dp|pub)\/$/i.test(baseHref)) {
      const baseTag = baseHref.replace(/\/$/, '');
      folderLinksSet.add(baseTag);
      if (!amendmentMap.has(baseTag)) amendmentMap.set(baseTag, []);
    }

    // 2) Any amendments nested under .amendments-block
    $ver.find('.amendments a').each((__, a) => {
      const ahrefRaw = $(a).attr('href') || '';
      const ahref = ahrefRaw.trim();
      if (/^\d{8}(?:-am\d+)?-(wd|cd|fcd|dp|pub)\/$/i.test(ahref)) {
        const amendTag = ahref.replace(/\/$/, '');
        folderLinksSet.add(amendTag);
        if (baseHref) {
          const baseTag = baseHref.replace(/\/$/, '');
          if (!amendmentMap.has(baseTag)) amendmentMap.set(baseTag, []);
          amendmentMap.get(baseTag).push(amendTag);
        }
      }
    });
  });

  const folderLinks = Array.from(folderLinksSet);

  if (!folderLinks.length) {
    console.warn(`\n⚠️ No release folders found at ${rootUrl}`);
    return [];
  }

  folderLinks.sort(); // oldest to newest
  const latestTag = folderLinks[folderLinks.length - 1];

  // Group base versions and amendments for later use
  const baseReleases = folderLinks.filter(tag => !/-am\d+-/.test(tag));

  const docs = [];
  let countHTML = 0, countPDF = 0, countNoIframe = 0;

  for (const releaseTag of folderLinks) {
    const isLatest = releaseTag === latestTag;
    const sourceUrl = `${rootUrl}${releaseTag}`

    console.log(`\n🔍 Processing ${sourceUrl}/`);

    // --- NEW: fetch wrapper at the folder root to inspect iframe and status/title ---
    let iframeSrc = null;
    let wrapperStates = new Set();
    let wrapperDesignator = null;
    let withdrawnNoticeHref = null;
    try {
      const wrapperRes = await axios.get(`${sourceUrl}/`);
      const $wrap = cheerio.load(wrapperRes.data);
      iframeSrc = ($wrap('#document').attr('src') || '').trim() || null;
      // Collect all #state entries; multiple may exist
      $wrap('span#state').each((_, el) => {
        const cls = ($wrap(el).attr('class') || '').split(/\s+/);
        cls.forEach(c => {
          if (c.startsWith('state-')) wrapperStates.add(c.replace('state-', '').toLowerCase());
        });
      });
      wrapperDesignator = ($wrap('#designator').text() || '').trim();
      withdrawnNoticeHref = ($wrap('#withdrawal-statement').attr('href') || '').trim() || null;

      const folderSlug = rootUrl.split('/').filter(Boolean).pop();
      const kind = iframeSrc ? (iframeSrc.endsWith('.pdf') ? 'PDF' : 'HTML') : 'none';
      console.log(`📂 ${folderSlug} | ${releaseTag} | iframe: ${kind}${iframeSrc ? '=' + iframeSrc : ''} | states: ${Array.from(wrapperStates).join(', ') || 'none'}`);

      if (!iframeSrc) countNoIframe++;
      else if (/\.pdf$/i.test(iframeSrc)) countPDF++;
      else countHTML++;
    } catch (e) {
      // Wrapper fetch failed — fall back to existing behavior
    }

    // --- If the iframe points to a PDF, treat as PDF-only but fill gaps from wrapper ---
    if (iframeSrc && /\.pdf$/i.test(iframeSrc)) {
      try {
        // Baseline from path inference (keeps your releaseTag/date/publisher etc.)
        const inferred = inferMetadataFromPath(rootUrl, releaseTag, baseReleases);
        // Title: prefer #designator (strip leading designator chunk), fallback to wrapper <title>
        let docTitle = null;
        if (wrapperDesignator) {
          const parts = wrapperDesignator.split(',');
          docTitle = parts.length > 1 ? parts.slice(1).join(',').trim() : wrapperDesignator.trim();
        }
        if (!docTitle) {
          try {
            const wrapperRes = await axios.get(`${sourceUrl}/`);
            const $wrap = cheerio.load(wrapperRes.data);
            const t = ($wrap('title').text() || '').trim();
            const p = t.split(',');
            docTitle = p.length > 1 ? p.slice(1).join(',').trim() : t;
          } catch {}
        }

        const doc = {
          ...inferred,
          ...(docTitle ? { docTitle } : {}),
          status: {
            ...(inferred.status || {}),
            ...(wrapperStates.has('stabilized') ? { stabilized: true } : {}),
            ...(wrapperStates.has('withdrawn') ? { withdrawn: true, active: false } : {}),
          }
        };
        if (withdrawnNoticeHref) {
          const absNotice = new URL(withdrawnNoticeHref, `${sourceUrl}/`).toString();
          doc.status = { ...(doc.status || {}), withdrawnNotice: absNotice };

          let suffix = 'link unreachable at extraction';
          try {
            const ok = await urlReachable(absNotice);
            suffix = ok ? 'verified reachable' : suffix;
          } catch (_) {}
          Object.defineProperty(doc, '__withdrawnNoticeSuffix', {
            value: suffix,
            enumerable: false
          });
        }

        Object.defineProperty(doc, '__sourceUrl', { value: `${sourceUrl}/`, enumerable: false });
        docs.push(doc);
        continue; // PDF-only handled; go to next releaseTag
      } catch (e) {
        console.warn(`⚠️ PDF-wrapper handling failed at ${sourceUrl}/: ${e.message}`);
      }
    }

    const indexUrl = `${sourceUrl}/${iframeSrc && !/\.pdf$/i.test(iframeSrc) ? iframeSrc : 'index.html'}`;

    try {
      const indexRes = await axios.get(indexUrl);
      const $index = cheerio.load(indexRes.data);

      const pubType = $index('[itemprop="pubType"]').attr('content');
      let pubNumber = $index('[itemprop="pubNumber"]').attr('content');
      // Normalize: force any letters in pubNumber to uppercase
      if (pubNumber) pubNumber = pubNumber.replace(/([a-z]+)/g, (m) => m.toUpperCase());
      const pubPart = $index('[itemprop="pubPart"]').attr('content');
      const pubDate = $index('[itemprop="pubDateTime"]').attr('content');
      const suiteTitle = $index('[itemprop="pubSuiteTitle"]').attr('content');
      const title = $index('title').text().trim();
      const tc = $index('[itemprop="pubTC"]').attr('content');

      const pubDateObj = dayjs(pubDate);
      const dateFormatted = pubDateObj.format('YYYY-MM-DD');
      const dateShort = pubDateObj.format('YYYY-MM');

      const docType = typeMap[pubType?.toUpperCase()] || pubType;
      let label = `SMPTE ${pubType} ${pubNumber}${pubPart ? `-${pubPart}` : ''}:${dateShort}`;
      let id = `SMPTE.${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}.${dateShort}`;
      // Special case: OM documents — label fixed to "SMPTE OM" and id maps from title via refMap patterns
      if ((pubType || '').toUpperCase() === 'OM') {
        const rawTitleForMap = (suiteTitle && suiteTitle.trim()) ? suiteTitle : title;
        const normTitleForMap = stripLeadingSmpte(rawTitleForMap);
        const mappedId = mapRefByCite(normTitleForMap) || mapRefByCite(rawTitleForMap);
        if (mappedId) {
          label = 'SMPTE OM';
          id = mappedId;
        }
      }
      const doi = `10.5594/SMPTE.${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}.${pubDateObj.format('YYYY')}`;
      const href = `https://doi.org/${doi}`;
      const pubTypeNum = `${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}`;
      const repoUrl = `https://github.com/SMPTE/${pubTypeNum.toLowerCase()}/`;

      const pubStage = $index('[itemprop="pubStage"]').attr('content');
      const pubState = $index('[itemprop="pubState"]').attr('content');

      // --- Extract publisher from HTML ---
      const pubPublisher =
        ($index('[itemprop="publisher"]').text() || $index('[itemprop="publisher"]').attr('content') || '').trim() || 'SMPTE';

      const refSections = { normative: [], bibliographic: [] };
      ['normative-references', 'bibliography'].forEach((sectionId) => {
        const type = sectionId.includes('normative') ? 'normative' : 'bibliographic';
        $index(`#sec-${sectionId} ul li`).each((_, el) => {
          const cite = $index(el).find('cite');
          const refText = cite.text();
          const href = $index(el).find('a.ext-ref').attr('href') || '';
          const refId = parseRefId(refText, href);
          if (refId) {
            if (Array.isArray(refId)) refSections[type].push(...refId);
            else refSections[type].push(refId);
          } else {
            badRefs.push({ docId: id, type, refText, href });
          }
        });
      });

      const revisionRaw = $index('[itemprop="pubRevisionOf"]').attr('content');
      let revisionOf;

      if (revisionRaw) {
        const match = revisionRaw.match(/SMPTE\s+([A-Z]+)\s+(\d+)(?:-(\d+))?:?(\d{4})(?:-(\d{2}))?/);
        if (match) {
          const [, type, number, part, year, month] = match;
          const suffix = (parseInt(year) >= 2023 && month) ? `${year}-${month}` : year;
          const baseId = `SMPTE.${type.toUpperCase()}${part ? `${number}-${part}` : number}.${suffix}`;
          revisionOf = [baseId];
        }
      }

      const doc = {
        docId: id,
        docLabel: label,
        docNumber: pubNumber,
        docPart: pubPart,
        docTitle: `${suiteTitle} ${title}`,
        docType,
        doi,
        group: `smpte-${tc.toLowerCase()}-tc`,
        publicationDate: dateFormatted,
        releaseTag,
        publisher: pubPublisher,
        href,
        repo: repoUrl,
        status: {
          active: isLatest && pubStage === 'PUB' && pubState === 'pub',
          latestVersion: isLatest,
          stage: pubStage,
          state: pubState,
          superseded: !isLatest
        },
        references: refSections,
        ...(revisionOf && { revisionOf })
      };

      Object.defineProperty(doc, '__sourceUrl', {
        value: `${sourceUrl}/`,
        enumerable: false
      });

      docs.push(doc);

    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 404) {
        console.warn(`⚠️ No index.html found at ${sourceUrl}/`);

        const inferred = inferMetadataFromPath(rootUrl, releaseTag, baseReleases);
        Object.defineProperty(inferred, '__sourceUrl', {
          value: `${sourceUrl}/`,
          enumerable: false
        });
        const existingIndex = docs.findIndex(d => d.docId === inferred.docId);
        if (existingIndex !== -1) {
          mergeInferredInto(docs[existingIndex], inferred);
        } else {
          docs.push(inferred);
        }
        console.warn(`📄 Likely PDF-only release — inferred docId: ${inferred.docId}`);
      } else {
        console.warn(`⚠️ Failed to fetch or parse ${indexUrl}: ${err.message}`);
      }
    }
  }

  try {
    if (amendmentMap && amendmentMap.size) {
      // Map releaseTag -> doc for quick lookup
      const byReleaseTag = new Map();
      for (const d of docs) {
        if (d && d.releaseTag) byReleaseTag.set(d.releaseTag, d);
      }

      for (const [baseTag, amendTags] of amendmentMap.entries()) {
        const baseDoc = byReleaseTag.get(baseTag);
        if (!baseDoc) continue;
        const amendIds = amendTags
          .map(t => byReleaseTag.get(t))
          .filter(Boolean)
          .map(d => d.docId)
          .filter(Boolean);
        baseDoc.status = baseDoc.status || {};
        if (amendIds.length) {
          baseDoc.status.amended = true;
          baseDoc.status.amendedBy = amendIds;
        }
      }

      for (const [baseTag, baseDoc] of byReleaseTag.entries()) {
        if (/-am\d+-/i.test(baseTag)) continue;
        baseDoc.status = baseDoc.status || {};
        if (baseDoc.status.amended === undefined) baseDoc.status.amended = false;
        if (!Array.isArray(baseDoc.status.amendedBy)) baseDoc.status.amendedBy = [];
      }
    }
  } catch (e) {
    console.warn(`⚠️ Amendment wiring failed for ${rootUrl}: ${e.message}`);
  }

  // --- Post-process: wire supersededBy to the next base release ---
  try {
    // Build map of releaseTag -> doc (reuse if already in scope would be fine, rebuild safely here)
    const byReleaseTag = new Map();
    for (const d of docs) {
      if (d && d.releaseTag) byReleaseTag.set(d.releaseTag, d);
    }

    // Identify base releases only (exclude amendment tags)
    const baseTags = Array.from(byReleaseTag.keys()).filter(t => !/-am\d+-/i.test(t)).sort();

    // For each base (except the last), compute next base and wire supersededBy
    for (let i = 0; i < baseTags.length - 1; i++) {
      const baseTag = baseTags[i];
      const nextBaseTag = baseTags[i + 1];
      const nextBaseDateStr = (nextBaseTag.match(/^(\d{4})(\d{2})(\d{2})/)) 
        ? `${nextBaseTag.slice(0,4)}-${nextBaseTag.slice(4,6)}-${nextBaseTag.slice(6,8)}`
        : undefined;

      const baseDoc = byReleaseTag.get(baseTag);
      const nextBaseDoc = byReleaseTag.get(nextBaseTag);
      if (!baseDoc || !nextBaseDoc || !nextBaseDoc.docId) continue;

      // Set on the base itself
      baseDoc.status = baseDoc.status || {};
      const nextList = [nextBaseDoc.docId];
      const prevListBase = Array.isArray(baseDoc.status.supersededBy) ? baseDoc.status.supersededBy : [];
      if (JSON.stringify(prevListBase) !== JSON.stringify(nextList)) {
        baseDoc.status.supersededBy = nextList;
      }
      if (nextBaseDateStr) {
        baseDoc.status.supersededDate = nextBaseDateStr;
      }

      // Also set on each amendment of this base: they are superseded by the next base too
      if (amendmentMap && amendmentMap.has(baseTag)) {
        const amendTags = amendmentMap.get(baseTag) || [];
        for (const amendTag of amendTags) {
          const amendDoc = byReleaseTag.get(amendTag);
          if (!amendDoc) continue;
          amendDoc.status = amendDoc.status || {};
          const prevListAmend = Array.isArray(amendDoc.status.supersededBy) ? amendDoc.status.supersededBy : [];
          if (JSON.stringify(prevListAmend) !== JSON.stringify(nextList)) {
            amendDoc.status.supersededBy = nextList;
          }
          if (nextBaseDateStr) {
            amendDoc.status.supersededDate = nextBaseDateStr;
          }
        }
      }
    }
    // Latest base (last in sequence) intentionally gets no supersededBy
  } catch (e) {
    console.warn(`⚠️ supersededBy wiring failed for ${rootUrl}: ${e.message}`);
  }

  try {
    for (const d of docs) {
      d.status = d.status || {};
      if (typeof d.status.superseded === 'undefined') {
        // Prefer the explicit latestVersion flag when available
        if (d.status.latestVersion === true) {
          d.status.superseded = false;
        } else if (d.status.latestVersion === false) {
          d.status.superseded = true;
        } else {
          // Fallback: when latestVersion is unknown, assume not superseded
          d.status.superseded = false;
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️ Superseded normalization failed for ${rootUrl}: ${e.message}`);
  }

  console.log(`📊 Release summary — HTML: ${countHTML}, PDF: ${countPDF}, none: ${countNoIframe}`);
  return docs;
};

// Main async block
(async () => {
  //const urls = require('../input/urls.json');
  let urls = await discoverFromRootDocPage(); // already filtered via filterDiscoveredDocs()
  // --- Optional: merge in seed URLs (union) ---
  const seedPath = 'src/main/input/seedUrls.smpte.json';
  const seedSet = new Set();
  let seedsAdded = 0, seedsSkipped = 0;
  if (fs.existsSync(seedPath)) {
    try {
      const rawSeeds = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
      if (Array.isArray(rawSeeds)) {
        for (const raw of rawSeeds) {
          const seed = normalizeSeedUrl(raw);
          if (!seed) continue;
          if (shouldFilterUrl(seed)) {
            seedsSkipped++;
            continue;
          }
          if (!urls.includes(seed)) {
            urls.push(seed);
            seedsAdded++;
          }
          seedSet.add(seed);
        }
      }
    } catch (e) {
      console.warn(`⚠️ Failed to read/parse ${seedPath}: ${e.message}`);
    }
  }
  console.log(`\n📂 Processing ${urls.length} SMPTE URLs... (seeds added: ${seedsAdded}, seeds skipped: ${seedsSkipped})`);
  
  const results = [];

  for (const url of urls) {
    try {
      const docs = seedSet.has(url)
        ? await extractFromSeedDoc(url)
        : await extractFromUrl(url);
      results.push(...docs);
    } catch (e) {
      console.error(`❌ Failed to process ${url}:`, e.message);
    }
  }

  const outputPath = 'src/main/data/documents.json';
  let existingDocs = [];

  if (fs.existsSync(outputPath)) {
    const raw = fs.readFileSync(outputPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      existingDocs = Array.isArray(parsed) ? parsed : parsed.documents || [];
    } catch (err) {
      console.error('Failed to parse existing documents.json:', err.message);
    }
  }

  const newDocs = [];
  const updatedDocs = [];
  const skippedDocs = [];

logSmart(`\n🛠 Beginning document merge/update phase... (${results.length} documents to check)`);
let processed = 0;

for (const doc of results) {
    let hasRefChanges = false;
    let addedRefs = { normative: [], bibliographic: [] };
    let removedRefs = { normative: [], bibliographic: [] };
    let duplicateNormRemoved = false;
    let duplicateBibRemoved = false;

    const index = existingDocs.findIndex(d => d.docId === doc.docId);
    logSmart(`  Checking ${doc.docId}...`);
    
    if (index === -1) {
      await resolveUrlAndInject(doc, 'href');
      const sourceType = doc.__inferred ? 'inferred' : 'parsed';
       if (doc.repo && !(await urlExistsNoRedirect(doc.repo))) {
        delete doc.repo;
      }
      injectMetaForDoc(doc, sourceType, 'new');
      if (doc.references) {
        injectMeta(doc.references, 'normative', sourceType, 'new', []);
        injectMeta(doc.references, 'bibliographic', sourceType, 'new', []);
      }
      if (doc.revisionOf) {
        injectMeta(doc, 'revisionOf', sourceType, 'new', []);
      }
      // Inject $meta for status.amendedBy on new docs when present
      if (doc.status && Array.isArray(doc.status.amendedBy)) {
        injectMeta(doc.status, 'amendedBy', sourceType, 'new', []);
      }
      if (doc.status && Array.isArray(doc.status.supersededBy)) {
        injectMeta(doc.status, 'supersededBy', 'resolved', 'new', []);
      }
      if (doc.status && typeof doc.status.supersededDate === 'string') {
        injectMeta(doc.status, 'supersededDate', 'resolved', 'new', null);
      }
      if (doc.status && doc.status.withdrawnNotice && doc.status['withdrawnNotice$meta'] && doc.__withdrawnNoticeSuffix) {
        // Normalize: strip any existing reachability suffix(es) before adding the current one
        const NOTE_SUFFIX_RE = /\s+—\s+(?:verified reachable|link unreachable at extraction)(?:\s+—\s+(?:verified reachable|link unreachable at extraction))*\s*$/;
        const currentNote = doc.status['withdrawnNotice$meta'].note || getMetaDefaults('parsed', 'status.withdrawnNotice').note;
        const baseNote = (currentNote || '').replace(NOTE_SUFFIX_RE, '') || getMetaDefaults('parsed', 'status.withdrawnNotice').note;
        const normalized = `${baseNote} — ${doc.__withdrawnNoticeSuffix}`;
        doc.status['withdrawnNotice$meta'].note = normalized;
      }
      logSmart(`   ➕ Adding ${doc.docId} (new document)`);
      newDocs.push(doc);
      existingDocs.push(doc);
      processed++;
      heartbeat(processed, results.length);
    } else {
      await resolveUrlAndInject(doc, 'href');
      if (doc.repo && !(await urlExistsNoRedirect(doc.repo))) {
        delete doc.repo;
      }
      const existingDoc = existingDocs[index];
      let changedFields = [];
      const oldValues = { ...existingDoc, status: { ...(existingDoc.status || {}) } };
      const newValues = { ...doc, status: { ...(doc.status || {}) } };

      const oldRefs = {
        normative: (existingDoc.references && existingDoc.references.normative) || [],
        bibliographic: (existingDoc.references && existingDoc.references.bibliographic) || []
      };
      const newRefs = {
        normative: (doc.references && doc.references.normative) || [],
        bibliographic: (doc.references && doc.references.bibliographic) || []
      };

      if (doc.references) {
        addedRefs = {
          normative: newRefs.normative.filter(ref => !oldRefs.normative.includes(ref)),
          bibliographic: newRefs.bibliographic.filter(ref => !oldRefs.bibliographic.includes(ref))
        };

        removedRefs = {
          normative: oldRefs.normative.filter(ref => !newRefs.normative.includes(ref)),
          bibliographic: oldRefs.bibliographic.filter(ref => !newRefs.bibliographic.includes(ref))
        };

        if (oldRefs.normative.length > new Set(oldRefs.normative).size) {
          duplicateNormRemoved = true;
        }

        if (oldRefs.bibliographic.length > new Set(oldRefs.bibliographic).size) {
          duplicateBibRemoved = true;
        }

        if (duplicateNormRemoved || duplicateBibRemoved) {
          if (!changedFields.includes('references')) {
            changedFields.push('references');
          }
        }

        hasRefChanges =
          addedRefs.normative.length > 0 || addedRefs.bibliographic.length > 0 ||
          removedRefs.normative.length > 0 || removedRefs.bibliographic.length > 0;

        if (hasRefChanges && !changedFields.includes('references')) {
          changedFields.push('references');
        }

        const refsChanged =
          refsAreDifferent(newRefs.normative, oldRefs.normative) ||
          refsAreDifferent(newRefs.bibliographic, oldRefs.bibliographic);

        if (refsChanged) {
          existingDoc.references = newRefs;
          newValues.references = newRefs;

          const fieldSource = doc.__inferred ? 'inferred' : 'parsed';
          injectMeta(existingDoc.references, 'normative', fieldSource, 'update', oldRefs.normative);
          injectMeta(existingDoc.references, 'bibliographic', fieldSource, 'update', oldRefs.bibliographic);
        }
      }

      // Update document fields if there are changes
      for (const key of Object.keys(doc)) {
        const oldVal = oldValues[key];
        const newVal = doc[key];
        const isEqual = typeof newVal === 'object'
          ? JSON.stringify(oldVal) === JSON.stringify(newVal)
          : oldVal === newVal;

        if (!isEqual) {
          if (key === 'references') {
            continue; 
          }

          const resolvedFields = ['docId', 'docLabel', 'doi', 'href', 'resolvedHref', 'repo'];
          const resolvedStatusFields = ['active', 'latestVersion', 'superseded'];

          if (key === 'status') {

            const statusFields = [
              'active',
              'latestVersion',
              'superseded',
              'stage',
              'state',
              'stabilized',
              'withdrawn',
              'withdrawnNotice',  
              'amended',
              'supersededDate'
            ];
            for (const field of statusFields) {
              if (newVal[field] !== undefined && existingDoc.status[field] !== newVal[field]) {
                const oldStatusVal = existingDoc.status[field];
                existingDoc.status[field] = newVal[field];
                const fieldSource = resolvedStatusFields.includes(field) ? 'resolved' : 'parsed';
                // Pass fully qualified name for correct metaConfig lookup
                injectMeta(existingDoc.status, field, fieldSource, 'update', oldStatusVal);
                if (!changedFields.includes('status')) changedFields.push('status');

              }
            }
            // Handle amendedBy (array) separately
            if (Array.isArray(newVal.amendedBy)) {
              const oldAB = Array.isArray(oldValues?.status?.amendedBy) ? oldValues.status.amendedBy : [];
              const newAB = newVal.amendedBy;
              const same = JSON.stringify(oldAB) === JSON.stringify(newAB);
              if (!same) {
                existingDoc.status.amendedBy = newAB;
                const fieldSourceAB = 'parsed';
                injectMeta(existingDoc.status, 'amendedBy', fieldSourceAB, 'update', oldAB);
                if (!changedFields.includes('status')) changedFields.push('status');
              }
            }
            // Handle supersededBy (array) similarly
            if (Array.isArray(newVal.supersededBy)) {
              const oldSB = Array.isArray(oldValues?.status?.supersededBy) ? oldValues.status.supersededBy : [];
              const newSB = newVal.supersededBy;
              const sameSB = JSON.stringify(oldSB) === JSON.stringify(newSB);
              if (!sameSB) {
                existingDoc.status.supersededBy = newSB;
                const fieldSourceSB = 'resolved'; // derived from cross-version wiring logic
                injectMeta(existingDoc.status, 'supersededBy', fieldSourceSB, 'update', oldSB);
                if (!changedFields.includes('status')) changedFields.push('status');
              }
            }
            const newWN = newVal.withdrawnNotice;
            const oldWN = oldValues?.status?.withdrawnNotice;
            if (newWN !== undefined) {
              // Only modify meta when the base field actually changes (to avoid PR noise)
              if (newWN !== oldWN) {
                if (!existingDoc.status['withdrawnNotice$meta']) {
                  injectMeta(existingDoc.status, 'withdrawnNotice', 'parsed', 'update', oldWN);
                }
                if (doc.__withdrawnNoticeSuffix) {
                  // Normalize: remove any trailing reachability suffix(es) and then add the current one exactly once
                  const NOTE_SUFFIX_RE = /\s+—\s+(?:verified reachable|link unreachable at extraction)(?:\s+—\s+(?:verified reachable|link unreachable at extraction))*\s*$/;
                  const currentNote = existingDoc.status['withdrawnNotice$meta'].note || getMetaDefaults('parsed', 'status.withdrawnNotice').note;
                  const baseNote = (currentNote || '').replace(NOTE_SUFFIX_RE, '') || getMetaDefaults('parsed', 'status.withdrawnNotice').note;
                  const normalized = `${baseNote} — ${doc.__withdrawnNoticeSuffix}`;
                  if (existingDoc.status['withdrawnNotice$meta'].note !== normalized) {
                    existingDoc.status['withdrawnNotice$meta'].note = normalized;
                  }
                }
                if (!changedFields.includes('status')) changedFields.push('status');
              }
            }
          } else if (key === 'revisionOf') {
            const oldList = Array.isArray(oldVal) ? oldVal.map(String) : [];
            const newList = Array.isArray(newVal) ? newVal.map(String) : [];

            // Merge and dedupe
            const merged = Array.from(new Set([...oldList, ...newList]));

            if (JSON.stringify(merged) !== JSON.stringify(oldList)) {
              existingDoc[key] = merged;
              newValues[key] = merged;

              const fieldSource = doc.__inferred ? 'inferred' : 'parsed';
              injectMeta(existingDoc, key, fieldSource, 'update', oldList);

              changedFields.push(key);
            }

            newValues[key] = existingDoc[key];

          } else {
            existingDoc[key] = newVal;
            const fieldSource = resolvedFields.includes(key) ? 'resolved' : 'parsed';
            injectMeta(existingDoc, key, fieldSource, 'update', oldVal);
            changedFields.push(key);
          }
        }
      }
      
      if (
        changedFields.length > 0 ||
        hasRefChanges ||
        duplicateNormRemoved ||
        duplicateBibRemoved
      ) {
        logSmart(`   ↻ Updating ${doc.docId} (fields: ${changedFields.length ? changedFields.join(', ') : 'references only'})`);
        updatedDocs.push({
          docId: doc.docId,
          fields: changedFields,
          addedRefs: {
            normative: [...addedRefs.normative],
            bibliographic: [...addedRefs.bibliographic]
          },
          removedRefs: {
            normative: [...removedRefs.normative],
            bibliographic: [...removedRefs.bibliographic]
          },
          duplicateNormRemoved,
          duplicateBibRemoved,
          oldValues,
          newValues
        });
        processed++;
        heartbeat(processed, results.length);
      } else {
        logSmart(`   ⤼ Skipped duplicate document`);
        skippedDocs.push(doc.docId);
        processed++;
        heartbeat(processed, results.length);
      }
    }
  }
  
  logSmart(`\n✅ Merge/update phase complete — processed ${processed}/${results.length}`);

  // Sort documents by docId
  existingDocs.sort((a, b) => a.docId.localeCompare(b.docId));

  // Write sorted documents to file
  fs.writeFileSync(
    outputPath,
    JSON.stringify(existingDocs, null, 2) + '\n'
  );

  console.log(`✅ Added ${newDocs.length} new documents.`);
  console.log(`🔁 Updated ${updatedDocs.length} documents.`);
  if (skippedDocs.length > 0) {
    console.log(`⚠️ Skipped ${skippedDocs.length} duplicate document(s):`);
    skippedDocs.forEach(docId => {
      console.log(`- ${docId}`);
    });
  }

  if (badRefs.length > 0) {
    console.log('🚫 Unparseable References Found:');
    badRefs.forEach(ref => {
      console.log(`- From ${ref.docId} (${ref.type}):`);
      console.log(`  - cite: ${ref.refText}`);
      if (ref.href) console.log(`  - href: ${ref.href}`);
    });
  }

  if (newDocs.length === 0 && updatedDocs.length === 0) {
    console.log('\nℹ️ No new or updated documents — skipping PR creation.');
    process.exit(0);
  }

  // --- PR log summary capping and full details file creation ---

  // Helper to slice with remainder count
  function sliceWithRemainder(arr, max) {
    return { shown: arr.slice(0, max), hidden: Math.max(0, arr.length - max) };
  }

  // Generate timestamp string in format YYYYMMDD-HHmmss
  const timestamp = dayjs().format('YYYYMMDD-HHmmss');
  const fullDetailsPath = `src/main/logs/extract-runs/pr-log-full-${timestamp}.log`;
  // Raw URL (kept for logging/diagnostics)
  const detailsFileRawUrl = `https://raw.githubusercontent.com/SteveLLamb/mediastandards-registry/main/${fullDetailsPath}`;
  // NEW: placeholder token that the workflow will replace with the PR /files#diff-<blob> link
  const DETAILS_DIFF_TOKEN = '__PR_DETAILS_DIFF_LINK__';

  // Format full details for Added
  function formatAddedDocFull(doc) {
    return `- ${doc.docId}`;
  }
  // Format full details for Updated
  function formatUpdatedDocFull(doc) {
    const lines = [`#### ${doc.docId} (updated fields: ${doc.fields.join(', ')})`];

    // Log field updates with old and new values
    doc.fields.forEach(field => {
      const oldVal = doc.oldValues[field];
      const newVal = doc.newValues[field];
      const formatVal = (val) => {
        if (val === undefined) return '`undefined`';
        if (val === null) return '`null`';
        if (typeof val === 'object') return '`' + mdEscape(JSON.stringify(val)) + '`';
        return '`' + mdEscape(String(val)) + '`';
      };

      if (field === 'status') {
        const oldStatus = doc.oldValues.status || {};
        const newStatus = doc.newValues.status || {};
        const statusFields = [
          'active',
          'latestVersion',
          'superseded',
          'stage',
          'state',
          'stabilized',
          'withdrawn',
          'withdrawnNotice',
          'amended',
          'supersededDate'
        ];
        const diffs = statusFields
          .filter(k => oldStatus[k] !== newStatus[k])
          .map(k => `${k}: ${formatVal(oldStatus[k])} → ${formatVal(newStatus[k])}`);
        // Also report amendedBy (array) changes
        const oldAB = Array.isArray(oldStatus.amendedBy) ? oldStatus.amendedBy : [];
        const newAB = Array.isArray(newStatus.amendedBy) ? newStatus.amendedBy : [];
        const amendedByChanged = JSON.stringify(oldAB) !== JSON.stringify(newAB);
        if (amendedByChanged) {
          diffs.push(`amendedBy: ${formatVal(oldAB)} → ${formatVal(newAB)}`);
        }
        // Also report supersededBy (array) changes
        const oldSB = Array.isArray(oldStatus.supersededBy) ? oldStatus.supersededBy : [];
        const newSB = Array.isArray(newStatus.supersededBy) ? newStatus.supersededBy : [];
        const supersededByChanged = JSON.stringify(oldSB) !== JSON.stringify(newSB);
        if (supersededByChanged) {
          diffs.push(`supersededBy: ${formatVal(oldSB)} → ${formatVal(newSB)}`);
        }
        if (diffs.length > 0) lines.push(`  - status changed: \r\n${diffs.join('\r\n')}`);
      } else if (field === 'revisionOf') {
        lines.push(`  - revisionOf changed: ${formatVal(oldVal || [])} → ${formatVal(newVal || [])}`);
      } else if (field === 'references') {
        // skip — refs summarized below
      } else {
        lines.push(`  - ${field}: ${formatVal(oldVal)} → ${formatVal(newVal)}`);
      }
    });

    // Added references
    const norm = doc.addedRefs.normative;
    const bibl = doc.addedRefs.bibliographic;
    if (norm.length || bibl.length) {
    if (norm.length) lines.push(`  - ➕ Normative Ref(s) added:\r\n ${norm.join('\r')}`);
    if (bibl.length) lines.push(`  - ➕ Bibliographic Ref(s) added:\r\n ${bibl.join('\r')}`);
    }

    // Removed references
    if (doc.removedRefs.normative.length) lines.push(`  - ➖ Normative Ref(s) removed:\r\n ${doc.removedRefs.normative.join('\r')}`);
    if (doc.removedRefs.bibliographic.length) lines.push(`  - ➖ Bibliographic Ref(s) removed:\r\n ${doc.removedRefs.bibliographic.join('\r')}`);

    if (doc.duplicateNormRemoved || doc.duplicateBibRemoved) {
      const types = [];
      if (doc.duplicateNormRemoved) types.push('normative');
      if (doc.duplicateBibRemoved) types.push('bibliographic');
      lines.push(`  - 🔄 Duplicate ${types.join('/')} reference(s) removed`);
    }
    return lines.join('\n');
  }

  // Prepare full details lines
  const fullDetailsLines = [];
  fullDetailsLines.push(`### 🆕 Added ${newDocs.length} new document(s):`);
  fullDetailsLines.push(...newDocs.map(formatAddedDocFull));
  fullDetailsLines.push('');
  fullDetailsLines.push(`### 🔁 Updated ${updatedDocs.length} existing document(s):`);
  updatedDocs.forEach(doc => {
    fullDetailsLines.push(formatUpdatedDocFull(doc));
  });
  fullDetailsLines.push('');
  fullDetailsLines.push(`### ⚠️ Skipped ${skippedDocs.length} duplicate(s)`);
  skippedDocs.forEach(docId => {
    fullDetailsLines.push(`- ${docId}`);
  });
  fullDetailsLines.push('');
  // Add unparseable refs if any
  if (badRefs.length > 0) {
    fullDetailsLines.push('### 🚫 Unparseable References Found:\n');
    badRefs.forEach(ref => {
      fullDetailsLines.push(`- From ${ref.docId} (${ref.type}):`);
      fullDetailsLines.push(`  - cite: ${ref.refText}`);
      if (ref.href) fullDetailsLines.push(`  - href: ${ref.href}`);
    });
    fullDetailsLines.push('');
  }

  // Write full details file
  fs.mkdirSync('src/main/logs/extract-runs', { recursive: true });
  fs.writeFileSync(fullDetailsPath, fullDetailsLines.join('\n'));

  // Cap summary for PR log
  const MAX_SUMMARY = 20;
  const addedSlice = sliceWithRemainder(newDocs, MAX_SUMMARY);
  const updatedSlice = sliceWithRemainder(updatedDocs, MAX_SUMMARY);

  // Build PR body lines — use TOKEN for the link target
  const prLines = [];
  prLines.push(`### 🆕 Added ${newDocs.length} new document(s):`);
  prLines.push(...addedSlice.shown.map(formatAddedDocFull));
  if (addedSlice.hidden > 0) {
    prLines.push(`…and ${addedSlice.hidden} more — [full list here](${DETAILS_DIFF_TOKEN})`);
  }
  prLines.push('');
  prLines.push(`### 🔁 Updated ${updatedDocs.length} existing document(s):`);
  updatedSlice.shown.forEach(doc => {
    prLines.push(formatUpdatedDocFull(doc));
  });
  if (updatedSlice.hidden > 0) {
    prLines.push(`…and ${updatedSlice.hidden} more — [full list here](${DETAILS_DIFF_TOKEN})`);
  }
  prLines.push('');
  prLines.push(`### ⚠️ Skipped ${skippedDocs.length} duplicate(s)`);
  prLines.push('');
  // Add unparseable refs summary to PR log if present
  if (badRefs.length > 0) {
    prLines.push('### 🚫 Unparseable References Found:\n');
    badRefs.forEach(ref => {
      prLines.push(`- From ${ref.docId} (${ref.type}):`);
      prLines.push(`  - cite: ${ref.refText}`);
      if (ref.href) prLines.push(`  - href: ${ref.href}`);
    });
    prLines.push('');
  }

  fs.writeFileSync(prLogPath, prLines.join('\n'));
  console.log(`\n📄 PR log updated: ${prLogPath}`);
  console.log(`📄 Full PR log details saved: ${fullDetailsPath}`);
  console.log(`🔗 Full details (raw): ${detailsFileRawUrl}`);

})();