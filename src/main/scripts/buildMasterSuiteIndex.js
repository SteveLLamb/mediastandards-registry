const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  // If there is no next token or the next token is another flag, use the default
  if (next == null || /^--/.test(next)) return def;
  return next;
}
function has(flag) { return process.argv.includes(flag); }

const IN = arg('--in', 'src/main/data/documents.json');
const OUT = arg('--out', 'src/main/reports/masterSuiteIndex.json');
const COUNT_ONLY = has('--count-only');
const PUB_COUNTS_OUT = arg('--pub-out', 'src/main/reports/masterSuiteIndex-publisherCounts.json');
const SKIPS_OUT = arg('--skips-out', 'src/main/reports/masterSuiteIndex-skippedDocs.json');
const SEPARATE_AUX = has('--separate-aux');

// --- helpers ---------------------------------------------------------------
// --- W3C normalization helpers -------------------------------------------
const W3C_ALIAS_MAP = {
  // Known historical shortname migrations / consolidations
  // Feel free to extend as you validate more families.
  'ttaf1-dfxp': 'ttml1'
};

// NIST historical/one-off id aliases
const NIST_ALIAS_MAP = {
  // KMGD = "Key Management Guideline Draft" (2002-06-03).
  // Treat as early draft aligned with SP 800-57 Part 1 lineage.
  // If later evidence contradicts this, update/remove this alias.
  'KMGD': { suite: 'SP', number: '800-57', part: '1' }
};

// Global one-off / exact-id aliases (use sparingly)
// Map a historically-seen or mistaken docId to the canonical docId we store in the index.
const GLOBAL_ALIAS_MAP = {
  // Examples (uncomment / extend as needed):
  // 'SMPTE.AG10b.2020': 'SMPTE.AG10B.2020',
  // 'W3C.ttaf1-dfxp.20061114': 'W3C.ttml1.20061114'
};

// Apply alias rewrites and light canonicalizations to a document in-place.
// If an alias is applied, sets `doc._aliasedFrom = <originalId>` and updates `doc.docId`.
function applyGlobalAliases(doc) {
  if (!doc || typeof doc.docId !== 'string') return;
  let id = doc.docId;
  let from = null;

  // 1) Exact-id alias map
  if (GLOBAL_ALIAS_MAP[id]) {
    from = id;
    id = GLOBAL_ALIAS_MAP[id];
  }

  // 2) Lightweight canonicalizations that we want to handle centrally
  //    SMPTE.AG<digits><letter> → uppercase the letter (AG10b → AG10B) to keep a single lineage
  //    Only canonicalize when followed by a dot (so we don't touch things like AG100 inadvertently)
  const mAg = id.match(/^SMPTE\.AG(\d+)([a-z])\./);
  if (mAg) {
    const up = `SMPTE.AG${mAg[1]}${mAg[2].toUpperCase()}.`;
    from = from || id;
    id = id.replace(/^SMPTE\.AG\d+[a-z]\./, up);
  }

  if (from && id !== doc.docId) {
    doc._aliasedFrom = from;
    doc.docId = id;
  }
}

function w3cExtractFromHref(href) {
  if (typeof href !== 'string') return null;
  // Matches https://www.w3.org/TR/<short>-YYYYMMDD/  (also http)
  const m = href.match(/^https?:\/\/www\.w3\.org\/TR\/([^/]+)-(\d{8})\/?$/i);
  if (!m) return null;
  return { shortname: m[1], trDate: m[2] };
}

function w3cExtractFromDocId(docId) {
  if (typeof docId !== 'string') return null;
  // Matches W3C.<short>.<YYYYMMDD|YYYY|YYYY-MM>
  const m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (!m) return null;
  return { shortname: m[1], trDate: /\d{8}/.test(m[2]) ? m[2] : null };
}

function w3cSplitFamilyVersion(shortname) {
  if (!shortname) return { family: null, version: null };
  const sn = String(shortname).toLowerCase();

  // Apply alias first
  const alias = W3C_ALIAS_MAP[sn];
  const canonical = alias || sn;

  // Common patterns where the version is at the tail:
  //   xmlc14n11 -> family xmlc14n, version 1.1
  //   xmldsig-core1 -> family xmldsig-core, version 1
  //   xmlschema-1 -> family xmlschema, version 1
  //   ttml.imsc1.0.1 -> family ttml.imsc, version 1.0.1 (IMSC special-case handled upstream)

  // If there is an obvious dotted version at the end
  let m = canonical.match(/^(.*?)(?:[._-](\d+(?:\.\d+)*))$/);
  if (m && m[1] && m[2]) {
    return { family: m[1], version: m[2] };
  }

  // If there is a trailing plain integer that represents a major version (e.g., core1, xmlschema-1)
  m = canonical.match(/^(.*?)(\d)$/);
  if (m && m[1] && m[2]) {
    return { family: m[1].replace(/[._-]$/, ''), version: m[2] };
  }

  // xmlc14n11 style: two trailing digits interpreted as 1.1 if family ends with 'c14n'
  m = canonical.match(/^(.*?c14n)(\d{2})$/);
  if (m) {
    return { family: m[1], version: `${m[2][0]}.${m[2][1]}` };
  }

  return { family: canonical, version: null };
}

function inferVersionFromTitleOrLabel(doc) {
  let inferred = null;
  const title = typeof doc.docTitle === 'string' ? doc.docTitle : '';
  const label = typeof doc.docLabel === 'string' ? doc.docLabel : '';

  // Prefer explicit Version/Level patterns
  let m = title.match(/\b(?:Version|Level)\s*(\d+(?:\.\d+)*)\b/i) ||
          label.match(/\b(?:Version|Level)\s*(\d+(?:\.\d+)*)\b/i);
  if (m) inferred = m[1];

  // Fallback: a bare dotted number like 1.0, 1.0.1 appearing in title/label
  if (!inferred) {
    m = title.match(/\b(\d+\.\d+(?:\.\d+)*)\b/) ||
        label.match(/\b(\d+\.\d+(?:\.\d+)*)\b/);
    if (m) inferred = m[1];
  }

  // Final fallback: a small integer (e.g., "2") only if clearly versioned context appears
  if (!inferred) {
    const intM = title.match(/\b(\d{1,2})\b/) || label.match(/\b(\d{1,2})\b/);
    const hasVersionCue = /\b(?:Version|Level|Spec(?:ification)?|Rec(?:ommendation)?)\b/i.test(title) ||
                          /\b(?:Version|Level|Spec(?:ification)?|Rec(?:ommendation)?)\b/i.test(label);
    if (intM && hasVersionCue) inferred = intM[1];
  }

  // Filters: ignore 4-digit years and edition ordinals
  if (inferred && /^\d{4}$/.test(inferred)) inferred = null; // looks like a year
  if (inferred && /\bEdition\b/i.test(title)) {
    // avoid conflating "Second Edition" → 2 with a semantic version
    if (/^\d+$/.test(inferred)) inferred = null;
  }

  return inferred;
}

function inferEditionFromTitle(doc) {
  if (typeof doc.docTitle !== 'string') return null;
  const mOrd = doc.docTitle.match(/\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+Edition\b/i);
  if (mOrd) {
    const map = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 };
    return map[mOrd[1].toLowerCase()] || null;
  }
  const mNum = doc.docTitle.match(/\b(\d+)(?:st|nd|rd|th)\s+Edition\b/i);
  if (mNum) return parseInt(mNum[1], 10);
  return null;
}

function normalizeW3C(doc) {
  if (!doc || typeof doc.docId !== 'string') return;
  if (!(doc.publisher === 'W3C' || /^W3C\./i.test(doc.docId))) return;

  const fromHref = w3cExtractFromHref(doc.href);
  const fromId   = w3cExtractFromDocId(doc.docId);
  const shortname = (fromHref && fromHref.shortname) || (fromId && fromId.shortname) || null;
  const trDate    = (fromHref && fromHref.trDate)    || (fromId && fromId.trDate)    || null;

  let { family, version } = w3cSplitFamilyVersion(shortname);

  // Consolidate W3C HTML Recommendations (html5/html52, with or without "rec-" prefix)
  // into a single lineage: key should be W3C|HTML|| (suite "HTML", number null)
  if (shortname && /^(?:rec-)?html(?:5|52)$/i.test(shortname)) {
    family = 'HTML';
    version = null;
  }

  // If version is still unknown, be conservative about inferring from title/label.
  // Only infer when shortname carries digits near letters (e.g., xmldsig-core1, xmlschema-1)
  // or when the title/label explicitly mentions Version/Level.
  if (!version) {
    const sn = shortname || '';
    const shortSuggestsVersion = /[a-z]\d|\d[a-z]|[._-]\d/i.test(sn);
    const textHasStrongCue = /\b(?:Version|Level)\b/i.test(doc.docTitle || '') ||
                             /\b(?:Version|Level)\b/i.test(doc.docLabel || '');
    if (shortSuggestsVersion || textHasStrongCue) {
      const inferred = inferVersionFromTitleOrLabel(doc);
      if (inferred) version = inferred;
    }
  }

  const edition = inferEditionFromTitle(doc);

  doc._w3c = {
    shortname,
    trDate,
    family,
    version,
    edition
  };
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return 'sha256:' + h.digest('hex');
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function publisherFromDoc(d) {
  // 1) If the document has an explicit publisher field, prefer it unconditionally.
  //    (Normalize to UPPERCASE, trim; do not validate shape — we want to carry first.)
  if (d && typeof d.publisher === 'string' && d.publisher.trim().length) {
    const raw = d.publisher.trim().toUpperCase();
    // Normalize co-branded strings like "ANSI/ASA" → "ASA"
    return raw.startsWith('ANSI/') ? raw.slice(5) : raw;
  }

  // 2) Try the same keying logic used by the index so "Found" matches "Added" when possible.
  if (d && typeof d.docId === 'string') {
    const k = keyFromDocId(d.docId, d);
    if (k && k.publisher) return String(k.publisher).toUpperCase();

    // Special-case RFC#### that didn't key (should rarely happen here)
    if (/^RFC\d+$/i.test(d.docId)) return 'IETF';

    // Otherwise, take the token before the first dot if it looks like a publisher-ish token
    const m = d.docId.match(/^([A-Za-z]{2,})\./);
    if (m) return m[1].toUpperCase();
  }

  // 3) Fall back to UNKNOWN when nothing else was available.
  return 'UNKNOWN';
}

// Doc types that do not participate in lineage graphs. We still carry them in
// the skipped report as FILTERED-by-docType for auditability.
const NON_LINEAGE_DOCTYPES = new Set([
  'Journal Article',
  'Magazine Article',
  'Technical Journal',
  'Book',
  'Patent',
  'White Paper',
  'Registry',
  'Technical Bulletin',
  'Technical Note',
  'Procedure',
  'Notation',
  'Manual',
  'Study Group Report',
  'Dissertation',
  'FAQ',
  'Style Guide'
]);

// Helper to infer versionless (evergreen) documents
function inferVersionless(doc) {
  // Honor explicit status.versionless when present
  if (doc && doc.status && typeof doc.status.versionless === 'boolean') {
    return doc.status.versionless;
  }
  const id = (doc && doc.docId) ? String(doc.docId) : '';
  const href = (doc && doc.href) ? String(doc.href) : '';
  // Well-known versionless specs
  if (/^WHATWG\.HTML$/i.test(id)) return true;
  if (/html\.spec\.whatwg\.org/i.test(href)) return true;
  // Add more publishers/IDs here as needed
  return false;
}

// Collect skipped (unkeyed or filtered) docs for reporting
function collectSkipped(allDocs) {
  const skipped = [];
  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    
    // Apply global aliases for skipped/added parity
    applyGlobalAliases(d);
    // Normalize W3C like buildIndex does to keep parity
    normalizeW3C(d);

    const pub = publisherFromDoc(d);

    // Versionless policy: do NOT filter out versionless if it keys; include it in lineage.
    // If a doc fails to key, always classify as UNKEYED (even if it appears versionless),
    // so we don't mask parser gaps behind a "versionless" reason.

    // 1) DocType-first policy: if this is a non-lineage document type, mark as FILTERED
    const dt = (d.docType || '').trim();
    if (dt && NON_LINEAGE_DOCTYPES.has(dt)) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: `docType=${dt}`,
        category: 'docType'
      });
      continue;
    }

    // 2) Draft policy: filter documents explicitly marked as draft (status.draft === true)
    if (d && d.status && d.status.draft === true) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: 'status.draft=true',
        category: 'policy'
      });
      continue;
    }

    // 3) Otherwise, try to key it; if unkeyed, it's a parser coverage gap.
    //    Classify as UNKEYED first to avoid mislabeling e.g. versionless-but-unkeyed as "versionless".
    const k = keyFromDocId(d.docId, d);
    if (!k) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'UNKEYED',
        rule: 'UNKEYED',
        ruleDetail: 'noRegexMatch',
        category: 'standard'
      });
      continue;
    }

    // 4) Keyed but policy-filtered (e.g., IEEE journals by suite)
    if (shouldSkipKey(k)) {
      const suite = (k.suite || '').toUpperCase();
      const cat = (k.publisher === 'IEEE' && /^(JRPROC|TMAG)$/.test(suite)) ? 'journal' : 'policy';
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: `policy:${k.publisher}.${suite || ''}`,
        category: cat,
        key: [k.publisher, k.suite || '', k.number, k.part || ''].join('|')
      });
    }
  }
  return skipped;
}

// Compute publisher → docId counts (sorted descending by count)
function computePublisherCounts(allDocs) {
  const counts = {};
  let total = 0;
  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    const pub = publisherFromDoc(d);
    counts[pub] = (counts[pub] || 0) + 1;
    total++;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
  return { total, counts: sorted };
}

function computeFlagSummary(lineages, maxExamplesPerType = 100) {
  const acc = {
    totalFlags: 0,
    byType: {}
  };
  if (!Array.isArray(lineages)) return acc;

  for (const li of lineages) {
    const lineageKey = li && li.key ? String(li.key) : '(unknown-key)';
    const flags = Array.isArray(li.flagInconsistencies) ? li.flagInconsistencies : [];
    for (const raw of flags) {
      const type = String(raw).split(':')[0]; // namespaced types keep prefix before first ':'
      if (!acc.byType[type]) acc.byType[type] = { count: 0, examples: [] };
      acc.byType[type].count++;
      acc.totalFlags++;
      // Keep a compact example (lineage key plus the raw flag for context)
      if (acc.byType[type].examples.length < maxExamplesPerType) {
        acc.byType[type].examples.push({ lineage: lineageKey, flag: raw });
      }
    }
  }

  // Stable sort by descending count when rendering to console (we don't mutate structure here)
  return acc;
}

// Bridge lineages to versionless successors (e.g., W3C HTML → WHATWG HTML)
// If a lineage has flag SUPERSEDED_BY_OUT_OF_LINEAGE:src->target and the target
// looks versionless, attach an externalLatest pointer for downstream "resolve latest".
function attachVersionlessSuccessors(lineages) {
  if (!Array.isArray(lineages)) return;
  const FLAG_RE = /^SUPERSEDED_BY_OUT_OF_LINEAGE:([^>]+)->([A-Za-z0-9._-]+)$/;

  for (const li of lineages) {
    const flags = Array.isArray(li.flagInconsistencies) ? li.flagInconsistencies : [];
    for (const f of flags) {
      const m = String(f).match(FLAG_RE);
      if (!m) continue;
      const targetId = m[2];

      // Minimal stub so inferVersionless/publisherFromDoc work without needing the full doc
      const stub = { docId: targetId };
      const isVersionless = inferVersionless(stub);
      if (isVersionless) {
        li.externalSuccessor = {
          reason: 'external-versionless',
          docId: targetId,
          publisher: publisherFromDoc(stub)
        }
        // Note: we intentionally do NOT change latestAnyId here.
        // Callers can prefer externalLatest when present.
      }
    }
  }
}

//function attachInlineVersionless(lineages) {
//  if (!Array.isArray(lineages)) return;
//
//  for (const li of lineages) {
//    if (!li || !Array.isArray(li.docs)) continue;
//
//    // If an external successor is already attached, keep it; this pass is only for in-line cases
//    if (li.versionlessSuccessor) continue;
//
//    const docs = li.docs.filter(Boolean);
//
//    // Collect all docs explicitly flagged versionless; do not exclude amendments here —
//    // the source data decides what is versionless, not our heuristics.
//    const versionlessDocs = docs.filter(d => d && d.status && d.status.versionless === true);
//
//    if (!versionlessDocs.length) continue; // nothing to do for this lineage
//
//    // If multiple versionless docs exist, pick the most recent by our canonical date key.
//    // This tolerates dates in either publicationDate/releaseTag or in the ID.
//    const pick = versionlessDocs.reduce((best, d) => {
//      const dk = dateKeyFromDoc(d);
//      if (!best) return { d, dk };
//      return dk >= best.dk ? { d, dk } : best;
//    }, null);
//
//    if (pick && pick.d) {
//      li.versionlessSuccessor = {
//        reason: 'in-lineage',
//        docId: pick.d.docId,
//        publisher: publisherFromDoc({ docId: pick.d.docId })
//      };
//    }
//  }
//}

function isAmendmentDocId(docId) {
  // SMPTE: ...YYYY[-MM]Am<d>.YYYY[-MM]
  const smpteAm = /\.20\d{2}(?:-\d{2})?Am\d\.\d{4}(?:-\d{2})?$/i;

  // ISO/IEC (and similar): ... .YYYY[-MM] (amd|cor)<digits> . YYYY[-MM]
  //   e.g., IEC.61966-2-1.1999amd1.2003 | IEC.60268-17.1990cor1.1991
  const isoIecAmCor = /\.(?:19|20)\d{2}(?:-\d{2})?(?:amd|cor)\d+\.(?:19|20)\d{2}(?:-\d{2})?$/i;

  // NIST SP amendments/addenda variants after the family token (e.g., 800-38A):
  //   • inline:   NIST.SP.800-38Aad1
  //   • hyphen:   NIST.SP.800-38A-Add      (no number)
  //   • hyphen#:  NIST.SP.800-38A-Add2     (with number)
  //   • may optionally be followed by a trailing date suffix like .YYYY or .YYYY-MM or .YYYYMMDD
  const nistSpInline = /^NIST\.SP\.\d+-[A-Za-z0-9]+(?:ad|add|amd)\d+(?:\.(?:\d{4}(?:-\d{2})?|\d{8}))?$/i;
  const nistSpHyphen  = /^NIST\.SP\.\d+-[A-Za-z0-9]+-(?:ad|add|amd)(?:\d+)?(?:\.(?:\d{4}(?:-\d{2})?|\d{8}))?$/i;

  // AES addendum pattern: base date followed by ad# and a second date
  //   e.g., aes11.2009ad1.2010
  const aesAd = /\.(?:19|20)\d{2}(?:-\d{2})?ad\d+\.(?:19|20)\d{2}(?:-\d{2})?$/i;

  // ITU-T amendments/errata: T-REC-<L>.<num>.<YYYY[MM]>am<d>.<YYYY[MM]> or ...e<d>.<YYYY[MM]>
  const ituTAmErr = /^T-REC-[A-Za-z]\.[0-9A-Za-z.]+\.(?:\d{6}|\d{4})(?:am\d+|e\d+)\.(?:\d{6}|\d{4})$/i;

  // ITU-R amendments/errata: R-REC-<L>.<num>-a<d>.<YYYY[MM]> or ...-e<d>.<YYYY[MM]>
  const ituRAmErr = /^R-REC-[A-Za-z]\.[0-9A-Za-z.]+-(?:a\d+|e\d+)\.(?:\d{6}|\d{4})$/i;

  // ICC errata: base .YYYYeYYYY (e.g., ICC.1.2010e2019)
  const iccErrata = /\.(?:19|20)\d{2}e\.?(?:19|20)\d{2}$/i;

  return (
    smpteAm.test(docId) ||
    isoIecAmCor.test(docId) ||
    nistSpInline.test(docId) ||
    nistSpHyphen.test(docId) ||
    aesAd.test(docId) ||
    ituTAmErr.test(docId) ||
    ituRAmErr.test(docId) ||
    iccErrata.test(docId)
  );
}

// Treat ATSC Annex (e.g., ATSC.AC3.A52.a.1995 or .AnnexA.) as supplements, not amendments
function isSupplementDocId(docId) {
  const atscAnnex = /^ATSC\.[^.]+\.[^.]+\.(?:a|annex[a-z])\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i;
  const ebuSupp = /^EBU\.(?:R|Tech)\d+s\d+\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i;
  return atscAnnex.test(docId) || ebuSupp.test(docId);
}

function dateKeyFromDoc(d) {
  // Build candidates:
  //  • from releaseTag (YYYYMMDD…)
  //  • from publicationDate (YYYY-MM-DD)
  //  • from rightmost date-like token in docId (handles ...am1.YYYY[MM][DD], ...e1.YYYY[MM])
  const keys = [];

  // releaseTag → prefer first 8 digits
  if (typeof d.releaseTag === 'string') {
    const m = d.releaseTag.match(/^(\d{8})/);
    if (m) keys.push(m[1]);
  }

  // publicationDate → YYYYMMDD
  if (typeof d.publicationDate === 'string') {
    const mPub = d.publicationDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mPub) keys.push(`${mPub[1]}${mPub[2]}${mPub[3]}`);
  }

  // --- extract rightmost date-like token from docId tail ---
  if (typeof d.docId === 'string') {
    const id = d.docId;
    // 1) .YYYYMMDD at end
    let m = id.match(/\.([12]\d{7})$/);
    if (m) keys.push(m[1]);

    // 2) .YYYY-MM-DD at end → YYYYMMDD
    if (!m) {
      const mYMDdash = id.match(/\.([12]\d{3})-(\d{2})-(\d{2})$/);
      if (mYMDdash) keys.push(`${mYMDdash[1]}${mYMDdash[2]}${mYMDdash[3]}`);
    }

    // 3) .YYYY- MMDD (e.g., 2012-1010, 2020-0714) → YYYYMMDD
    if (!m) {
      const mY_MMD = id.match(/\.([12]\d{3})-(\d{4})$/);
      if (mY_MMD) keys.push(`${mY_MMD[1]}${mY_MMD[2]}`);
    }

    // 4) .YYYY-MM → YYYYMM00 (sorts before full day)
    if (!m) {
      const mYM = id.match(/\.([12]\d{3})-(\d{2})$/);
      if (mYM) keys.push(`${mYM[1]}${mYM[2]}00`);
    }

    // 5) .YYYY → YYYY0000
    if (!m) {
      const mY = id.match(/\.([12]\d{3})$/);
      if (mY) keys.push(`${mY[1]}0000`);
    }
  }

  // If we found any candidates, return the max (latest) lexicographically.
  if (keys.length) {
    keys.sort();
    return keys[keys.length - 1];
  }

  // last-resort floor
  return '00000000';
}

// True if a doc yields any concrete date key from releaseTag, publicationDate, or docId
function isDatedDoc(d) {
  return dateKeyFromDoc(d) !== '00000000';
}

// Extract a 4-digit year from the docId tail, for cross-checks
function yearFromDocIdTail(docId) {
  // Looks for .YYYYMMDD or .YYYY-MM or .YYYY at the end of the docId
  const m8 = docId && docId.match(/\.([12]\d{3})(?:\d{2}){2}$/); // .YYYYMMDD
  if (m8) return parseInt(m8[1], 10);
  const mYM = docId && docId.match(/\.([12]\d{3})-\d{2}$/);      // .YYYY-MM
  if (mYM) return parseInt(mYM[1], 10);
  const mY = docId && docId.match(/\.([12]\d{3})$/);             // .YYYY
  if (mY) return parseInt(mY[1], 10);
  return null;
}

function keyFromDocId(docId, doc = {}) {
  // Draft policy: do not key documents explicitly marked as draft
  if (doc && doc.status && doc.status.draft === true) return null;
  
  // Special-case: SMPTE RP series with inline edition token `v##` (treat as RP family, no part)
  // Examples:
  //   SMPTE.RP224v12.2012    → RP 224, part: null (edition 12)
  //   SMPTE.RP210v13.2012    → RP 210, part: null (edition 13)
  // We normalize these to avoid creating fake parts from the `v##` token.
  let m = docId.match(/^SMPTE\.RP(\d+)v\d+\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'SMPTE', suite: 'RP', number: m[1], part: null };
  }

  // --- OWASP documents: OWASP.<suite>.<doc> ---
  // Example: OWASP.CS.TLP → { publisher: 'OWASP', suite: 'CS', number: 'TLP', part: null }
  m = docId.match(/^OWASP\.([A-Za-z0-9]+)\.([A-Za-z0-9-]+)$/i);
  if (m) {
    return { publisher: 'OWASP', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- SMPTE AG/OM (without date) special-case ---
  // Match SMPTE.AG<num>[-<subpart>][.<YYYY> or .<YYYY-MM> or .<YYYYMMDD>], but also allow no date
  // e.g., SMPTE.AG02, SMPTE.AG06-01, SMPTE.OM01, SMPTE.OM02-01
  m = docId.match(/^SMPTE\.(AG|OM)(\d+)(?:-([0-9]+))?(?:\.(?:\d{4}(?:-\d{2}){0,2}|\d{8}))?$/i);
  if (m) {
    // e.g., SMPTE.AG02 → AG, 02, null; SMPTE.AG06-01 → AG, 06, 01
    return { publisher: 'SMPTE', suite: m[1].toUpperCase(), number: m[2], part: m[3] || null };
  }
  // SMPTE OM sub-suites without numeric series, e.g., SMPTE.OM.Std, SMPTE.OM.BL.20240101
  m = docId.match(/^SMPTE\.OM\.([A-Za-z][A-Za-z0-9-]*)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    // Treat the token after OM as the lineage "number" slot so Std and BL live in distinct buckets
    return { publisher: 'SMPTE', suite: 'OM', number: m[1], part: null };
  }
  // SMPTE.ST429-6.2023-05 -> {publisher:"SMPTE", suite:"ST", number:"429", part:"6"}
  m = docId.match(/^SMPTE\.(OM|AG|ST|RP|EG|ER|RDD|OV|TSP)(\d+[A-Za-z]*)(?:-(\d+))?\./i);
  if (m) {
    const docType = m[1].toUpperCase();
    const num = m[2];
    let part = m[3] || null;

    // OV is always part 0 (e.g., OV2067-0, OV2094-0). If missing, normalize to "0".
    if (docType === 'OV') {
      part = part || '0';
    }

    // For ST/RP/EG/RDD/OV: use the SMPTE doc type as the lineage suite to avoid cross-type collisions (e.g., RP6 vs RDD6)
    return { publisher: 'SMPTE', suite: docType, number: num, part };
  }

  // OMG specs: OMG.<doc>[.<version-ish>]
  // We treat the token after OMG. as the doc family (lineage key) and ignore the rest as version info.
  m = docId.match(/^OMG\.([A-Za-z0-9]+)(?:\.[A-Za-z0-9.-]+)?$/i);
  if (m) {
    return { publisher: 'OMG', suite: m[1].toUpperCase(), number: null, part: null };
  }

  // ISO/IEC Directives: ISO.Dir-P2.2011, ISO.Dir-P3.2021 etc.
  // Suite is 'Dir', number is 'P<part>', no part field.
  m = docId.match(/^ISO\.Dir-P(\d+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'ISO/IEC', suite: 'Dir', number: `P${m[1]}`, part: null };
  }

  // ISO / IEC series with optional (possibly composite) part token
  // Examples:
  //   IEC.61966-2-1.1999  -> number: 61966, part: 2-1
  //   IEC.60268-3.2018    -> number: 60268, part: 3
  //   ISO.8601-1.2019     -> number: 8601,  part: 1
  m = docId.match(/^(ISO(?:\.IEC)?|IEC)\.(\d+)(?:-([0-9-]+))?\./i);
  if (m) {
    return { publisher: m[1].toUpperCase(), suite: null, number: m[2], part: m[3] || null };
  }

  // IESNA Recommended Practice, e.g., IESNA.RP16.1996
  m = docId.match(/^IESNA\.RP(\d+)\.(\d{4})$/i);
  if (m) {
    return { publisher: 'IESNA', suite: 'RP', number: m[1], part: null };
  }

  // IMFUG Best Practices: IMFUG.BP.<doc>.<date>
  // Examples:
  //   IMFUG.BP.DS1.2020
  //   IMFUG.BP.001.2020 (preserve leading zeros)
  // Date tail supports .YYYY, .YYYY-MM, or .YYYYMMDD
  m = docId.match(/^IMFUG\.BP\.([A-Za-z0-9-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'IMFUG', suite: 'BP', number: m[1], part: null };
  }

  // ISDCF documents: ISDCF.<token>.<date> or ISDCF.<token>
  // Examples:
  //   ISDCF.D02.2011 → { publisher: 'ISDCF', suite: null, number: 'D02', part: null }
  //   ISDCF.RP-430-10.2018 → { publisher: 'ISDCF', suite: null, number: 'RP-430-10', part: null }
  //   ISDCF.P-HFR.2012 → { publisher: 'ISDCF', suite: null, number: 'P-HFR', part: null }
  //   ISDCF.DCNC → { publisher: 'ISDCF', suite: null, number: 'DCNC', part: null }
  m = docId.match(/^ISDCF\.([A-Za-z0-9-]+)(?:\.(\d{4}(?:-\d{2}){0,2}|\d{8}))?$/i);
  if (m) {
    return { publisher: 'ISDCF', suite: null, number: m[1], part: null };
  }

  // Texas Instruments DLP specs: TI.DLP-<doc>[.<version-ish>][.<date>]
  // Example: TI.DLP-CCC.1.1-rC.2005 → { publisher: 'TI', suite: 'DLP', number: 'CCC', part: null }
  // We key on the family token after "DLP-" and ignore any version/date tails for lineage.
  m = docId.match(/^TI\.DLP-([A-Za-z0-9-]+)(?:\.[A-Za-z0-9.-]+)?(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) {
    return { publisher: 'TI', suite: 'DLP', number: m[1], part: null };
  }

  // UNICODE CONSORTIUM — Unicode Standard & Technical Reports
  //   UNICODE.STD.TR9-25  → { publisher:'UNICODE CONSORTIUM', suite:'STD', number:'TR', part:'9' }
  //   UNICODE.STD.5.1.0   → { publisher:'UNICODE CONSORTIUM', suite:'STD', number:null, part:null }
  m = docId.match(/^UNICODE\.STD\.TR(\d+)(?:[-.][A-Za-z0-9.-]+)?$/i);
  if (m) {
    return { publisher: 'UNICODE CONSORTIUM', suite: 'STD', number: 'TR', part: m[1] };
  }
  m = docId.match(/^UNICODE\.STD\.(\d+(?:\.\d+){1,2})$/i);
  if (m) {
    return { publisher: 'UNICODE CONSORTIUM', suite: 'STD', number: null, part: null };
  }

  // W3C shortnames: W3C.shortname.YYYYMMDD, W3C.shortname.YYYY, W3C.shortname.YYYY-MM, or W3C.shortname.LATEST
  // e.g., W3C.xmlschema-1.20041028, W3C.xmldsig-core1.LATEST, W3C.rddl.2002, W3C.rddl.2010, W3C.rddl.2010-03
  m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?|LATEST)$/i);
  if (m) {
    // Ensure W3C normalization is applied for keying parity
    if (!doc._w3c) normalizeW3C(doc);
    const suiteToken = m[1];

    // If we already normalized W3C fields on the full doc, prefer those for stable keying
    if (doc._w3c && doc._w3c.family) {
      const fam = doc._w3c.family; // keep canonical casing from normalizer
      const num = (fam.toUpperCase() === 'HTML') ? null : (doc._w3c.version || null);
      return { publisher: 'W3C', suite: fam, number: num, part: null };
    }

    // Normalize shortname token locally for robust keying
    let token = suiteToken;
    // Drop the REC- prefix if present (e.g., REC-html52 → html52)
    token = token.replace(/^REC-/i, '');

    // Consolidate HTML5/HTML52 into a single lineage: W3C|HTML||
    if (/^html(?:5|52)$/i.test(token)) {
      return { publisher: 'W3C', suite: 'HTML', number: null, part: null };
    }

    // Try to detect a version-style numeric suffix (e.g., "1.0.1", "1.1", "3.1") and treat as number
    // Accepts trailing numeric segments separated by [._-]
    const versionMatch = token.match(/^(.*?)(?:[._-]?(\d+(?:\.\d+)*))$/);
    if (versionMatch && versionMatch[2]) {
      if (versionMatch[1] && versionMatch[2]) {
        return { publisher: 'W3C', suite: versionMatch[1], number: versionMatch[2], part: null };
      }
    }
    return { publisher: 'W3C', suite: token, number: null, part: null };
  }

  // --- WHATWG (versionless, no date) --------------------------------------
  // Capture the suite token dynamically so we don't hardcode e.g. "HTML".
  // Example: WHATWG.HTML → { publisher:"WHATWG", suite:"HTML", number:null, part:null }
  m = docId.match(/^WHATWG\.([A-Za-z0-9-]+)$/i);
  if (m) {
    return { publisher: 'WHATWG', suite: m[1].toUpperCase(), number: null, part: null };
  }

  // IETF RFC: rfcXXXX (any case). Normalize to publisher IETF, suite RFC, number = digits
  m = docId.match(/^rfc(\d+)$/i);
  if (m) {
    return { publisher: 'IETF', suite: 'RFC', number: m[1], part: null };
  }

  // IETF.<suite>[.<version-ish>].<date>
  // Examples:
  //   IETF.FLS.2001
  //   IETF.JSON.2022
  //   IETF.JSON.draft-bhutton-json-schema-00.2020
  // We ignore the middle token(s) and key strictly on the suite.
  m = docId.match(/^IETF\.([A-Za-z0-9-]+)(?:\.[A-Za-z0-9._-]+)?\.(\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'IETF', suite: m[1].toUpperCase(), number: null, part: null };
  }

  // NAB Standards: NAB.STD.<doc>[.<date>]
  // Example: NAB.STD.E-416.1965 → { publisher: 'NAB', suite: 'STD', number: 'E-416', part: null }
  m = docId.match(/^NAB\.STD\.([A-Za-z0-9-]+)(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) {
    return { publisher: 'NAB', suite: 'STD', number: m[1], part: null };
  }

  // NIST FIPS: group by family; treat dash suffix as edition (not a part)
  // Examples: NIST.FIPS.140-1, NIST.FIPS.186-2, NIST.FIPS.197
  m = docId.match(/^NIST\.FIPS\.(\d+(?:-\d+)?)$/i);
  if (m) {
    const token = m[1];            // e.g., "140-1" or "186" or "186-4"
    const fam = token.replace(/^(\d+).*/, '$1'); // take leading digits only → family number
    return { publisher: 'NIST', suite: 'FIPS', number: fam, part: null };
  }

  // NIST one-off aliases (carry into proper SP family)
  m = docId.match(/^NIST\.([A-Za-z0-9-]+)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) {
    const token = m[1].toUpperCase();
    if (NIST_ALIAS_MAP[token]) {
      const a = NIST_ALIAS_MAP[token];
      return { publisher: 'NIST', suite: a.suite, number: a.number, part: a.part || null };
    }
  }

  // --- NIST Special Publications ---
  // Examples that should share a family lineage:
  //   NIST.SP.800-57p1r2007         -> family "800-57", part "1"
  //   NIST.SP.800-57pt1r5.2020      -> family "800-57", part "1"
  //   NIST.SP.800-57p2              -> family "800-57", part "2"
  //   NIST.SP.800-38D.2001          -> family "800-38D", (no part)
  //   NIST.SP.500-291r2.2013        -> family "500-291", (no part)
  m = docId.match(/^NIST\.SP\.([A-Za-z0-9-]+)(?:\.(\d{4}(?:-\d{2})?|\d{8}))?$/i);
  if (m) {
    const tail = m[1]; // e.g., "800-57p1r2007", "800-38D", "500-291r2"
    // Split tail into family, optional part token(s), and optional revision token(s)
    //  - family: "<series>-<doc>[letter]" (e.g., 800-38D, 500-291, 800-57)
    //    stop BEFORE part tokens (p/pt/part<digits>), addendum/amendment tokens (ad/add/amd, with or without digits), or revision tokens (r<digits>)
    const famMatch = tail.match(/^(\d+-[0-9A-Za-z]+?)(?=(?:pt|p|part)\s*\d+|(?:-?(?:ad|add|amd))(?:\s*\d+)?|r\s*\d+|$)/i);
    if (famMatch) {
      const family = famMatch[1];       // "800-57", "800-38D", "500-291"
      const rest   = tail.slice(family.length); // e.g., "p1r2007", "", "r2"
      let part = null;

      // Detect common part encodings (p1, pt1, part1)
      const partMatch = rest.match(/(?:^|[^A-Za-z])(pt|p|part)\s*([0-9]+)/i);
      if (partMatch) {
        part = String(parseInt(partMatch[2], 10)); // "1", "2", ...
      }

      return { publisher: 'NIST', suite: 'SP', number: family, part };
    }
    // Fallback: if we couldn't split, just bucket the whole tail as family
    return { publisher: 'NIST', suite: 'SP', number: tail, part: null };
  }

  // --- DCI (Digital Cinema Initiatives) -----------------------------------
  // Families observed in source data (tracked as distinct documents):
  //   • DCSS (Digital Cinema System Spec) versions: DCI.DCSS.v1.4.0.2020-0720
  //   • DCA-* (Addenda/Advisories): DCI.DCA-DVD.2023-0301, DCI.DCA-HDR.2023-0301, ...
  //   • M-* (Memos): DCI.M-DVD.2018-0627, DCI.M-HDR.2021-0701, ...
  //   • RP-* and S-* (Recommended Practice / Specification notes): DCI.RP-HFR.2012-0928, DCI.S-TES.2019-0329

  // DCSS: treat the series as the suite and group all versions into a single lineage (number: null)
  // Example: DCI.DCSS.v1.4.2.2022-0615 → {publisher:"DCI", suite:"DCSS", number:null, part:null}
  // Accept .YYYYMMDD | .YYYY-MM | .YYYY-MM-DD | .YYYY- MMDD (e.g., 2012-1010, 2020-0714)
  m = docId.match(/^DCI\.([A-Za-z]+)\.(v\d+(?:\.\d+)*?)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m && /^DCSS$/i.test(m[1])) {
    return { publisher: 'DCI', suite: m[1].toUpperCase(), number: null, part: null };
  }

  // DCA-* advisories/addenda: bucket by the subtype token after DCA-
  // Example: DCI.DCA-DVD.2023-0301 → {publisher:"DCI", suite:"DCA", number:"DVD", part:null}
  m = docId.match(/^DCI\.DCA-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) {
    return { publisher: 'DCI', suite: 'DCA', number: m[1].toUpperCase(), part: null };
  }

  // M-* memos: single memo series where each subtype acts like a "part"
  // Example: DCI.M-DVD.2018-0627 → {publisher:"DCI", suite:"M", number:null, part:"DVD"}
  m = docId.match(/^DCI\.M-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) {
    return { publisher: 'DCI', suite: 'M', number: null, part: m[1].toUpperCase() };
    // Note: part can be a non-numeric token; sorter already handles string parts.
  }

  // RP-* and S-* technical notes: keep the token before '-' as suite, after '-' as number
  // Examples:
  //   DCI.RP-HFR.2012-0928 → {publisher:"DCI", suite:"RP", number:"HFR", part:null}
  //   DCI.S-TES.2019-0329  → {publisher:"DCI", suite:"S",  number:"TES", part:null}
  m = docId.match(/^DCI\.([A-Za-z]+)-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) {
    return { publisher: 'DCI', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };
  }

  // --- EIDR (Entertainment ID Registry) ----------------------------------
  // Forms: EIDR.ID.<YYYYMM>, EIDR.SV-DFR.<YYYYMM>
  // Keying: publisher=EIDR, suite=token before number, number=token (e.g., "ID", "SV-DFR")
  m = docId.match(/^EIDR\.([A-Za-z0-9-]+)\.(\d{6}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'EIDR', suite: null, number: m[1].toUpperCase(), part: null };
  }

  // --- ICC (International Color Consortium) -------------------------------
  // Forms: ICC.<number>.<YYYY>[e<YYYY>]
  // Keying: publisher=ICC, suite=ICC, number=<number>, part=null
  // Examples:
  //   ICC.1.2004           → {publisher:"ICC", suite:"ICC", number:"1", part:null}
  //   ICC.1.2010           → {publisher:"ICC", suite:"ICC", number:"1", part:null}
  //   ICC.1.2010e2019      → same lineage; `e2019` treated as errata via isAmendmentDocId
  m = docId.match(/^ICC\.(\d+)\.(?:\d{4})(?:e\.?\d{4})?$/i);
  if (m) {
    return { publisher: 'ICC', suite: null, number: m[1], part: null };
  }

  // --- AMWA (Advanced Media Workflow Association) ---------------------------
  // Accept both canonical and legacy forms with optional date tails.
  // Canonical examples:
  //   • AMWA.AAF[.date]
  //   • AMWA.AS-11[.date]
  // Canonical AAF
  m = docId.match(/^AMWA\.(AAF)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) {
    return { publisher: 'AMWA', suite: m[1].toUpperCase(), number: null, part: null };
  }
  // Canonical AS-<num>
  m = docId.match(/^AMWA\.(AS)-(\d+)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) {
    return { publisher: 'AMWA', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // ANSI legacy S-series that predate explicit ASA branding
  // Examples:
  //   ANSI.S4.3.1982            → {publisher:"ASA", suite:"S4", number:"3", part:null}
  //   ANSI.S1.11.p1.2014        → {publisher:"ASA", suite:"S1", number:"11", part:"1"}
  m = docId.match(/^ANSI\.S(\d+)(?:\.(\d+))?(?:\.(p?\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const suite = `S${m[1]}`;           // e.g., "S4"
    const number = m[2] || null;        // e.g., "3"
    const rawPart = m[3] || null;       // e.g., "p1" or "1"
    const part = rawPart ? String(rawPart).replace(/^p/i, '') : null;
    return { publisher: 'ASA', suite, number, part };
  }

   // --- ANSI partner families (normalize lineage publisher to provided ANSI/… when present) ---
  // ASA S-series (optionally dotted sub-number) with optional part token like .p1
  // Examples:
  //   ASA.S1.11.1986           → {publisher:"ASA", suite:"S1", number:"11", part:null}
  //   ASA.S1.11.p1.2014        → {publisher:"ASA", suite:"S1", number:"11", part:"1"}
  m = docId.match(/^ASA\.S(\d+)(?:\.(\d+))?(?:\.(p?\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'ASA';
    const suite = `S${m[1]}`;           // e.g., "S4"
    const number = m[2] || null;        // e.g., "3"
    const rawPart = m[3] || null;       // e.g., "p1" or "1"
    const part = rawPart ? String(rawPart).replace(/^p/i, '') : null;
    return { publisher: pub, suite, number, part };
  }

  // PIMA IT-series (e.g., PIMA.IT9.2.1998 → IT series 9, part 2)
  m = docId.match(/^PIMA\.IT(\d+)(?:\.(\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'PIMA';
    return { publisher: pub, suite: 'IT', number: m[1], part: m[2] || null };
  }

  // UL standards (treat token after UL. as the standard number)
  //   UL.94.2015 → {publisher:"UL", suite:null, number:"94"}
  m = docId.match(/^UL\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'UL';
    return { publisher: pub, suite: null, number: m[1], part: null };
  }

  // INCITS X-series and successors
  //   INCITS.X3.4.1986 → {publisher:"INCITS", suite:"X3", number:"4"}
  m = docId.match(/^INCITS\.([A-Za-z0-9]+)\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'INCITS';
    return { publisher: pub, suite: m[1], number: m[2], part: null };
  }

  // NFPA (e.g., NFPA.90A.2018)
  m = docId.match(/^NFPA\.([0-9A-Za-z.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'NFPA';
    return { publisher: pub, suite: null, number: m[1], part: null };
  }

  // AIIM MS-series (e.g., AIIM.MS34.1990)
  m = docId.match(/^AIIM\.([A-Za-z]+)(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'AIIM';
    return { publisher: pub, suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // ASHRAE (e.g., ASHRAE.52.1.2019)
  m = docId.match(/^ASHRAE\.([0-9A-Za-z.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'ASHRAE';
    return { publisher: pub, suite: null, number: m[1], part: null };
  }

  // NAPM (National Association of Photographic Manufacturers)
  // Handle IT series (e.g., NAPM.IT9.1.1996) and generic NAPM.<series>.<part>.<date>
  m = docId.match(/^NAPM\.IT(\d+)(?:\.(\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:T\d+\.\d+\.\d{4})?$/i);
  if (m) {
    const pub = 'NAPM';
    return { publisher: pub, suite: 'IT', number: m[1], part: m[2] || null };
  }

  // Generic NAPM series: NAPM.<series>.<part>.<date> → suite:null, number=<series>, part=<part>
  m = docId.match(/^NAPM\.(\d+)\.(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'NAPM';
    return { publisher: pub, suite: null, number: m[1], part: m[2] };
  }

  // AIM (Association for Automatic Identification and Mobility)
  // Barcode/auto-ID specs such as AIM.BC4.1999
  // Normalize to publisher AIM, suite = series token (e.g., BC), number = digits
  // Accept optional hyphen between series token and number, and typical date tails
  m = docId.match(/^AIM\.([A-Za-z]+)-?(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    const pub = 'AIM';
    return { publisher: pub, suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- ARIB (Association of Radio Industries and Businesses) --------------
  // Typical form:
  //   ARIB.STD-B32.v2.1.2001
  // Pattern: ARIB.<suite>-<series>[.<subseries>].v<version>.<YYYY or YYYY-MM or YYYYMMDD>
  // For lineage, group on the B-series token (e.g., "B32") and ignore inline version.
  m = docId.match(/^ARIB\.([A-Za-z]+)-([A-Za-z]\d+(?:\.[A-Za-z0-9]+)?)\.v\d+(?:\.\d+)*\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    // Use the captured suite for ARIB (e.g., "STD", "TR", etc.)
    // Number captures the B-series (or similar) token; part remains null.
    return { publisher: 'ARIB', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };
  }

  // --- ITU‑T (T‑REC) ------------------------------------------------------
  //
  // Keying rule: drop the "T-REC" prefix. Suite is the single letter
  // that follows (E, H, T, X, ...). Number is the digits (with optional dot/letter),
  // and we ignore the trailing date segment(s) and any amendment/errata tails for lineage keying.
  //
  // Forms accepted:
  //   T-REC-<L>.<num>.<YYYY|YYYYMM>
  //   T-REC-<L>.<num>.<YYYY|YYYYMM>am<d>.<YYYY|YYYYMM>
  //   T-REC-<L>.<num>.<YYYY|YYYYMM>e<d>.<YYYY|YYYYMM>
  //
  // IMPORTANT: Use non-greedy capture for <num> so it stops before the date segment,
  // preventing cases like "E.123.2001am1" from being parsed as number="123.2001".
  m = docId.match(/^T-REC-([A-Za-z])\.([0-9A-Za-z.]+?)\.(\d{6}|\d{4})(?:(am\d+|e\d+)\.(\d{6}|\d{4}))?$/i);
  if (m) {
    const suiteLetter = m[1].toUpperCase();
    const number = m[2]; // e.g., "123", "X.509", "H.264"
    return { publisher: 'ITU-T', suite: suiteLetter, number, part: null };
  }

  // --- ITU-R (R-REC) ------------------------------------------------------
//
// Keying rule: drop the "R-REC" prefix. Suite is the series letters
// (BR, BS, BT, etc.). The number is the core identifier; a trailing
// dash + small integer is typically an edition/revision (BT.709-6),
// while for certain BR four-digit series a trailing -1/-2 denotes parts
// (e.g., BR.1352-1, BR.1352-2). We treat '-a#' as an amendment and
// '-e#' as errata to the base.
//
// Forms accepted:
//   R-REC-<L>.<num>.<YYYY|YYYYMM>
//   R-REC-<L>.<num>-a<d>.<YYYY|YYYYMM>   (amendment)
//   R-REC-<L>.<num>-e<d>.<YYYY|YYYYMM>   (errata)
//   R-REC-<L>.<num>-<rev>.<YYYY|YYYYMM>  (edition/revision)
//
// Heuristics:
//   • If core looks like "<four digits>-<1..9>" and suite is BR, treat as part.
//   • Else if core looks like "<digits>-<1..30>", treat as edition (strip the -rev for lineage).
//   • Otherwise keep the core as-is (e.g., BT.6-270 stays "6-270").
m = docId.match(/^R-REC-([A-Za-z]{1,3})\.([0-9A-Za-z.]+?)(?:-(a\d+|e\d+|[0-9]+))?\.(\d{6}|\d{4})$/i);
if (m) {
  const suiteLetter = m[1].toUpperCase();
  const core = m[2];                // e.g., "709", "1352-1", "6-270"
  const tail = m[3] || null;        // "a2", "e1", or plain "6", "10"
  let number = core;
  let part = null;

  // Analyze a simple "<digits>-<digits>" core
  const rev = core.match(/^(\d+)-(\d+)$/);
  if (rev) {
    const left = rev[1], right = parseInt(rev[2], 10);
    if (suiteLetter === 'BR' && left.length === 4 && right >= 1 && right <= 9) {
      // BR.1352-1, BR.1352-2 → treat as parts
      number = left;
      part = String(right);
    } else if (right >= 1 && right <= 30) {
      // Common edition marker like BT.709-6 → strip the trailing '-6' for lineage
      number = left;
    } else {
      // Keep as-is for things like BT.6-270 (not an edition; part of the identifier)
      number = core;
    }
  }

  return { publisher: 'ITU-R', suite: suiteLetter, number, part };
}

  // --- ATSC ---------------------------------------------------------------
  // Forms we support (carry into one lineage per AC3 family & A52 number):
  //   ATSC.AC3.A52.2015
  //   ATSC.AC3.A52.2018
  //   ATSC.AC3.A52.a.1995   (annex update for the 1995 edition)
  //   ATSC.AC3.A52.AnnexA.1995 (new annex forms)
  // Keying rule: suite = <family> (e.g., AC3), number = <standard number> (e.g., A52), part = null
  // Annex token ".a." or ".AnnexA." is treated as an amendment by isAmendmentDocId(); lineage key is unaffected.
  m = docId.match(/^ATSC\.([A-Za-z0-9-]+)\.([A-Za-z0-9-]+)\.(?:(?:a|annex[a-z])\.)?(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'ATSC', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };
  }

  // --- TIFF (special case) -------------------------------------------------
  // Rule: suite = "TIFF"; treat "r6" as a version label but do not use it
  // for number/part in the lineage key. Group all TIFF revisions into one lineage.
  m = docId.match(/^TIFF\.r\d+(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) {
    return { publisher: 'Aldus Corp/Adobe', suite: 'TIFF', number: null, part: null };
  }

  // --- IEEE ---------------------------------------------------------------
  // IEEE standards may appear as IEEE.754.2019 or IEEE.STD754.2019 or IEEE.STD1003.1.2008
  // Normalize all to suite "STD" with numeric (possibly dotted) standard number.
  m = docId.match(/^IEEE\.(?:STD)?([0-9]+(?:\.[0-9]+)?)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'IEEE', suite: 'STD', number: m[1], part: null };
  }

  // --- AES (Audio Engineering Society) ------------------------------------
  // Accept canonical and legacy lowercase forms. Group by standard number and optional part.
  // Examples:
  //   AES.11.2003                → {publisher:"AES", suite:null, number:"11", part:null}
  //   AES.31-2.2019              → {publisher:"AES", suite:null, number:"31", part:"2"}
  //   aes11.2009ad1.2010         → {publisher:"AES", suite:null, number:"11", part:null} (amendment flagged elsewhere)
  //   aes31-2.2019               → {publisher:"AES", suite:null, number:"31", part:"2"}
  //   aes-r2.2004                → {publisher:"AES", suite:"R",  number:"2",  part:null}

  // Canonical AES with optional hyphen part and optional amendment tail
  m = docId.match(/^AES\.(\d+)(?:-([0-9]+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:ad\d+\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) {
    return { publisher: 'AES', suite: null, number: m[1], part: m[2] || null };
  }
  // Legacy lowercase prefix without dot after AES
  m = docId.match(/^aes(\d+)(?:-([0-9]+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:ad\d+\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) {
    return { publisher: 'AES', suite: null, number: m[1], part: m[2] || null };
  }
  // AES Recommended practices like aes-r2.2004 → suite R, number 2
  m = docId.match(/^AES[-\.]R(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'AES', suite: 'R', number: m[1], part: null };
  }

  // --- AMPAS S series: ampas-s-2008-001, ampas-s-2013-001, etc.
  // Normalize to publisher "AMPAS", suite "S", number as year, part as trailing digits
  m = docId.match(/^AMPAS\.S\.(\d{4})-(\d{3})$/i);
  if (m) {
    return { publisher: 'AMPAS', suite: 'S', number: m[1], part: m[2] };
  }

  // --- CEA (Consumer Electronics Association) -----------------------------
  // Forms: CEA.<number>.<YYYY> or .<YYYY-MM>
  m = docId.match(/^CEA\.(\d+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'CEA', suite: null, number: m[1], part: null };
  }

  // --- CEN (European Committee for Standardization) -----------------------
  // Forms: CEN.EN.<number>.<YYYY> or .<YYYY-MM>
  //        CEN.TR.<number>.<YYYY> or .<YYYY-MM>
  m = docId.match(/^CEN\.(EN|TR)\.([A-Za-z0-9-]+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'CEN', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- EBU (European Broadcasting Union) ---------------------------------
  // Forms:
  //   EBU.R<digits>[s<digits>].<YYYY or YYYY-MM or YYYYMMDD>
  //   EBU.Tech<digits>[s<digits>].<YYYY or YYYY-MM or YYYYMMDD>
  // Keying:
  //   suite = "R" or "Tech"; number = the digits after the suite; ignore optional `s#` supplement for lineage.
  // Update: allow for optional 's' with or without digits (e.g., 's', 's1', 's2', etc.)
  m = docId.match(/^EBU\.(R|Tech)(\d+)(?:s\d*)?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'EBU', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- ETSI (European Telecommunications Standards Institute) --------------
  // Forms: ETSI.<suite>-<number>.<YYYY> or ETSI.<suite>-<number>.<YYYY-MM>
  // Examples: ETSI.ETR-154.1997, ETSI.EN-300-294.2005, ETSI.TS-101-154.2012
  m = docId.match(/^ETSI\.([A-Za-z]+)-([0-9-]+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'ETSI', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- CIE (International Commission on Illumination) --------------------
  // Forms: CIE.<three-digit standard number>.<YYYY|YYYY-MM|YYYYMMDD>
  // Keep leading zeros in the number (e.g., 015 stays "015").
  m = docId.match(/^CIE\.(\d{3})\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'CIE', suite: null, number: m[1], part: null };
  }

  // --- CTA (Consumer Technology Association) -----------------------------
  // Forms: CTA.<number>-G.<YYYY>
  // Example: CTA.861-G.2016
  // Keying: publisher = CTA, suite = null, number = <number>, part = null
  // The -G is a revision/version, not part of the lineage key.
  m = docId.match(/^CTA\.(\d+)-[A-Za-z]\.\d{4}$/i);
  if (m) {
    return { publisher: 'CTA', suite: null, number: m[1], part: null };
  }

  // --- FIAF (International Federation of Film Archives) --------------------
  // Forms: FIAF.<suite>.<number>.<YYYY | YYYY-MM | YYYYMMDD>
  // Example: FIAF.TR.FP.1997  → suite "TR", number "FP"
  m = docId.match(/^FIAF\.([A-Za-z]+)\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'FIAF', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- DMA (U.S. Defense Mapping Agency) -----------------------------------
  // Forms: DMA.TR.<number>.<year?>
  // Example: DMA.TR.8350.2 → {publisher:"U.S. DEFENSE MAPPING AGENCY", suite:"TR", number:"8350.2"}
  m = docId.match(/^DMA\.(TR)\.([0-9.]+)$/i);
  if (m) {
    return { publisher: 'U.S. DEFENSE MAPPING AGENCY', suite: m[1].toUpperCase(), number: m[2], part: null };
  }

  // --- DPP (Digital Production Partnership) -------------------------------
  // Forms: DPP.003, DPP.004, DPP.005
  // Example: DPP.003 → {publisher:"DPP", suite:null, number:"003", part:null}
  m = docId.match(/^DPP\.(\d{3})$/i);
  if (m) {
    return { publisher: 'DPP', suite: null, number: m[1], part: null };
  }

  return null;
}

function shouldSkipKey(k) {
  // Filter from the main report for now.

  return false;
}

// --- main ------------------------------------------------------------------

function buildIndex(allDocs) {
  const map = new Map(); // keyStr -> { key, docs: [...] }

  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    // Normalize obvious aliases before any parsing/keying
    applyGlobalAliases(d);
    // Enrich W3C documents with normalized family/version info for stable keying
    normalizeW3C(d);
    const k = keyFromDocId(d.docId, d);
    if (!k || shouldSkipKey(k)) continue;

    // Capture original SMPTE doc type token and part (if present) for lineage diagnostics
    let _srcDocType = null;
    let _srcPart = null;
    const smpteHead = d.docId.match(/^SMPTE\.(OM|AG|ST|RP|EG|RDD|OV)(\d+)(?:-(\d+))?\./i);
    if (smpteHead) {
      _srcDocType = smpteHead[1].toUpperCase();
      _srcPart = smpteHead[3] ? String(smpteHead[3]) : (smpteHead[1].toUpperCase() === 'OV' ? '0' : null);
    }

    const keyStr = [k.publisher, k.suite || '', k.number, k.part || ''].join('|');
    if (!map.has(keyStr)) map.set(keyStr, { key: k, docs: [] });

    const status = d.status || {};
    const _statusLatest = !!(status.latestVersion === true);
    const statusActive = (typeof status.active === 'boolean') ? status.active : _statusLatest;
    const statusSuperseded = (typeof status.superseded === 'boolean') ? status.superseded : (!_statusLatest && (typeof status.latestVersion === 'boolean'));
    const statusWithdrawn = !!status.withdrawn;
    const statusStabilized = !!status.stabilized;
    const statusAmended = !!status.amended;
    const statusVersionless = d.status.versionless === true
    const releaseTag = typeof d.releaseTag === 'string' ? d.releaseTag : null;
    const _isSupplement = isSupplementDocId(d.docId);

    map.get(keyStr).docs.push({
      docId: d.docId,
      publicationDate: d.publicationDate || null,
      releaseTag,
      statusActive,
      statusSuperseded,
      statusWithdrawn,
      statusStabilized,
      statusAmended,
      statusVersionless,
      _dk: dateKeyFromDoc(d),
      _isBase: !isAmendmentDocId(d.docId) && !_isSupplement,
      _isSupplement,
      _statusLatest,
      _srcDocType,
      _srcPart,
      // Graph lineage hints (private)
      _supersededBy: Array.isArray(status.supersededBy) ? status.supersededBy.slice() : [],
      _supersededDate: (status && status.supersededDate) ? String(status.supersededDate) : null,
      // W3C debug fields for alias/collision checks
      _w3cShortname: (d._w3c && d._w3c.shortname) || null,
      _w3cFamily: (d._w3c && d._w3c.family) || null,
      // Global alias provenance
      _aliasedFrom: d._aliasedFrom || null,
    });
  }

  const lineages = [];
  for (const [keyStr, entry] of map.entries()) {
    // Sort ascending by date key
    entry.docs.sort((a, b) => a._dk.localeCompare(b._dk));

    // Build quick lookup for in-lineage docId → doc (for graph analysis)
    const idIndex = new Map(entry.docs.map(d => [d.docId, d]));

    const bases = entry.docs.filter(x => x._isBase);
    const supplements = entry.docs.filter(x => x._isSupplement);
    const amendments  = entry.docs.filter(x => !x._isBase && !x._isSupplement); 
    const flaggedBases = bases.filter(x => x._statusLatest);
    const flaggedAny = entry.docs.filter(x => x._statusLatest);

    // Helper: choose the newest by date key from a list
    const pickNewest = (arr) => arr.length ? arr.reduce((a, b) => (a._dk >= b._dk ? a : b)) : null;

    // Graph candidates: nodes with no supersededBy edge that stays within this lineage
    const baseGraphHeads = bases.filter(b => !b._supersededBy.some(id => idIndex.has(id) && idIndex.get(id)._isBase));
    const anyGraphHeads  = entry.docs.filter(d => !d._supersededBy.some(id => idIndex.has(id)));

    // Resolution order: explicit latest flag → graph heads → newest by date
    const latestBase = flaggedBases.length ? pickNewest(flaggedBases)
                        : (baseGraphHeads.length ? pickNewest(baseGraphHeads)
                        : pickNewest(bases));

    const latestAny  = flaggedAny.length ? pickNewest(flaggedAny)
                        : (anyGraphHeads.length ? pickNewest(anyGraphHeads)
                        : pickNewest(entry.docs));

    // Lineage-level helpers
    const hasActiveBase = bases.some(x => x.statusActive === true);
    const hasWithdrawn = entry.docs.some(x => x.statusWithdrawn === true);
    const hasStabilized = entry.docs.some(x => x.statusStabilized === true);

    const activeBases = bases.filter(x => x.statusActive === true);
    const supersededBases = bases.filter(x => x.statusSuperseded === true);
    const latestActiveBase = activeBases.length ? activeBases[activeBases.length - 1] : null;
    const latestSupersededBase = supersededBases.length ? supersededBases[supersededBases.length - 1] : null;

    // Previous base pointer (immediately before latestActiveBase by date order)
    let prevBase = null;
    if (latestActiveBase) {
      const idx = bases.indexOf(latestActiveBase);
      if (idx > 0) prevBase = bases[idx - 1];
    }

    // Inconsistency flags (lineage-level)
    const flags = [];
    // W3C lineage diagnostics
    if (entry.key.publisher === 'W3C') {
      // If this lineage aggregates multiple docs but has no version in key, flag for cleanup
      if (entry.docs.length > 1 && (entry.key.number == null || entry.key.number === '')) {
        flags.push('W3C_MISSING_VERSION');
      }

      // Detect raw shortname alias collisions collapsing to one family
      const rawShorts = Array.from(new Set(entry.docs.map(x => x._w3cShortname).filter(Boolean)));
      const famSet = new Set(entry.docs.map(x => x._w3cFamily).filter(Boolean));
      if (rawShorts.length > 1 && famSet.size === 1) {
        // If any of the raw shortnames is a known alias for another present token, flag it
        for (const [alias, canonical] of Object.entries(W3C_ALIAS_MAP)) {
          if (rawShorts.includes(alias) && (rawShorts.includes(canonical) || famSet.has(canonical))) {
            flags.push(`W3C_ALIAS_COLLISION:${alias}=>${canonical}`);
            break;
          }
        }
        // Generic multi-shortname collapse into single family
        if (!flags.some(f => f.startsWith('W3C_ALIAS_COLLISION:'))) {
          flags.push(`W3C_ALIAS_COLLISION:${rawShorts.join(',')}=>${Array.from(famSet)[0]}`);
        }
      }
    }
    if (flaggedAny.length > 1) flags.push('MULTIPLE_LATEST_FLAGS');
    if (flaggedAny.length >= 1) {
      const maxDk = entry.docs[entry.docs.length - 1]?._dk || null;
      // if any latest-flagged doc predates the max date key, warn
      const anyLatestBeforeMax = flaggedAny.some(x => maxDk && x._dk < maxDk);
      if (anyLatestBeforeMax) flags.push('LATEST_FLAG_BEFORE_DATE');
    }
    if (entry.docs.some(x => !x._isBase) && bases.length === 0) {
      flags.push('MISSING_BASE_FOR_AMENDMENT');
    }

    // SMPTE cross-type lineage diagnostics: same numeric family but mixed doc types (e.g., RP6 + RDD6)
    if (entry.key.publisher === 'SMPTE') {
      const typeSet = new Set(entry.docs.map(x => x._srcDocType).filter(Boolean));
      if (typeSet.size > 1) {
        flags.push('MIXED_SMPTE_DOCTYPES');
        const anyParts = entry.docs.some(x => x._srcPart !== null && x._srcPart !== undefined && x._srcPart !== '');
        if (!anyParts) {
          flags.push('DOC_TYPE_CHANGE_WITHOUT_PART');
        }
      }
    }

    // Superseded graph diagnostics
    // 1) Edges pointing outside this lineage
    for (const d of entry.docs) {
      for (const tgt of d._supersededBy || []) {
        if (!idIndex.has(tgt)) {
          flags.push(`SUPERSEDED_BY_OUT_OF_LINEAGE:${d.docId}->${tgt}`);
        }
      }
    }
    // 2) If there are explicit latest flags but graph suggests a different head
    if (flaggedAny.length) {
      const graphHead = pickNewest(anyGraphHeads);
      const flagHead  = pickNewest(flaggedAny);
      if (graphHead && flagHead && graphHead.docId !== flagHead.docId) {
        flags.push(`LATEST_FLAG_CONFLICT_WITH_GRAPH:any:${flagHead.docId}<>${graphHead.docId}`);
      }
    }
    if (flaggedBases.length) {
      const graphBaseHead = pickNewest(baseGraphHeads);
      const flagBaseHead  = pickNewest(flaggedBases);
      if (graphBaseHead && flagBaseHead && graphBaseHead.docId !== flagBaseHead.docId) {
        flags.push(`LATEST_FLAG_CONFLICT_WITH_GRAPH:base:${flagBaseHead.docId}<>${graphBaseHead.docId}`);
      }
    }

    // Per-doc sanity checks -> emit concise, namespaced flags (no auto-fix)
    for (const x of entry.docs) {
      // Alias lineage flag: always surface if an alias rewrite occurred
      if (x._aliasedFrom) {
        flags.push(`ALIASED_ID:${x._aliasedFrom}->${x.docId}`);
      }
      // 1) Contradictory status combos
      if (x.statusWithdrawn && x.statusActive) {
        flags.push(`CONTRADICTORY_STATUS_FLAGS:${x.docId}:ACTIVE_AND_WITHDRAWN`);
      }
      if (x.statusSuperseded && x.statusActive) {
        flags.push(`CONTRADICTORY_STATUS_FLAGS:${x.docId}:ACTIVE_AND_SUPERSEDED`);
      }

      // 2) docId year vs publicationDate year mismatch
      if (x.publicationDate && /^\d{4}-\d{2}-\d{2}$/.test(x.publicationDate)) {
        const pubYear = parseInt(x.publicationDate.slice(0, 4), 10);
        const idYear = yearFromDocIdTail(x.docId);
        if (idYear && pubYear && idYear !== pubYear) {
          flags.push(`DOCID_PUBDATE_MISMATCH:${x.docId}:docIdYear=${idYear},pubYear=${pubYear}`);
        }
      }

      // W3C edition without a reliable date (TR date or publicationDate)
      if (entry.key.publisher === 'W3C') {
        const hasEdition = d => d && d._w3c && Number.isInteger(d._w3c.edition);
        const src = (allDocs || []).find(dd => dd && dd.docId === x.docId);
        if (src && hasEdition(src)) {
          const hasDate = Boolean(x.releaseTag) || Boolean(x.publicationDate);
          if (!hasDate) {
            flags.push(`W3C_EDITION_WITHOUT_DATE:${x.docId}`);
          }
        }
      }
    }

    // Emit lean docs (drop private fields, but include helpful status fields)
    const docsPublic = entry.docs.map(x => ({
      docId: x.docId,
      publicationDate: x.publicationDate,
      releaseTag: x.releaseTag,
      statusActive: x.statusActive,
      statusSuperseded: x.statusSuperseded,
      statusWithdrawn: x.statusWithdrawn,
      statusStabilized: x.statusStabilized,
      statusAmended: x.statusAmended,
      statusVersionless: x.statusVersionless
    }));

    const lineageObj = {
      key: keyStr,
      publisher: entry.key.publisher,
      suite: entry.key.suite,
      number: entry.key.number,
      part: entry.key.part,
      // W3C lineage annotations for clarity in reports
      w3cFamily: entry.key.publisher === 'W3C' ? entry.key.suite : undefined,
      w3cVersion: entry.key.publisher === 'W3C' ? (entry.key.number || null) : undefined,
      docs: docsPublic,
      latestBaseId: latestBase ? latestBase.docId : null,
      latestAnyId: latestAny ? latestAny.docId : null,
      latestDateKey: latestAny ? latestAny._dk : null,
      hasActiveBase,
      hasWithdrawn,
      hasStabilized,
      latestActiveBaseId: latestActiveBase ? latestActiveBase.docId : null,
      latestSupersededBaseId: latestSupersededBase ? latestSupersededBase.docId : null,
      prevBaseId: prevBase ? prevBase.docId : null,
      flagInconsistencies: flags,
      counts: {
        bases: bases.length,
        amendments: amendments.length,
        supplements: supplements.length
      }
    };

      lineages.push(lineageObj);

  }

  // Stable sort for deterministic output: by publisher, suite, number (numeric/lex), part (numeric/lex)
  lineages.sort((a, b) => {
    const ap = a.publisher.localeCompare(b.publisher);
    if (ap) return ap;
    const as = (a.suite || '').localeCompare(b.suite || '');
    if (as) return as;
    const aNum = Number(a.number), bNum = Number(b.number);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const s = String(a.number).localeCompare(String(b.number));
      if (s) return s;
    }
    const aPartNum = Number(a.part), bPartNum = Number(b.part);
    if (!Number.isNaN(aPartNum) && !Number.isNaN(bPartNum)) {
      if (aPartNum !== bPartNum) return aPartNum - bPartNum;
    } else {
      return String(a.part || '').localeCompare(String(b.part || ''));
    }
    return 0;
  });

  return lineages;
}

(function main() {
  if (!fs.existsSync(IN)) {
    console.error(`❌ Input not found: ${IN}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(IN, 'utf8');
  let docs = [];
  try {
    const parsed = JSON.parse(raw);
    docs = Array.isArray(parsed) ? parsed : parsed.documents || [];
  } catch (e) {
    console.error(`❌ Failed to parse JSON: ${e.message}`);
    process.exit(1);
  }

  // Pre-calc skipped docs (unkeyed/filtered) grouped by publisher for reporting
  const skippedDocs = collectSkipped(docs);
  const skippedByPublisher = {};
  for (const s of skippedDocs) {
    const pub = (s.publisher || 'UNKNOWN').toUpperCase();
    if (!skippedByPublisher[pub]) skippedByPublisher[pub] = { count: 0, docIds: [], items: [] };
    skippedByPublisher[pub].count++;
    // Keep the legacy flat list for quick scanning
    skippedByPublisher[pub].docIds.push(s.docId);
    // Also store a rich item with the reason inline so you don't have to jump to `details`
    const { docId, publisher, reason, rule, ruleDetail, category, key } = s;
    skippedByPublisher[pub].items.push({ docId, reason, rule, ruleDetail, category, key });
  }

  // Build a simple reason summary and keep a detailed list for audits
  // Always include all possible reason categories with count 0 if not present
  const SKIP_REASONS = ['FILTERED', 'UNKEYED', 'UNKNOWN'];
  const skippedSummary = skippedDocs.reduce((acc, s) => {
    const r = s.reason || 'UNKNOWN';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, Object.fromEntries(SKIP_REASONS.map(r => [r, 0])));

  // Pre-calc publisher counts for unified report
  const pubCountsSummary = computePublisherCounts(docs);

  // Optional quick publisher counts
  if (has('--publisher-counts')) {
    const summary = pubCountsSummary; // already computed
    console.log('📊 Publisher → docId counts');
    for (const [pub, n] of Object.entries(summary.counts)) {
      console.log(pub.padEnd(10), '→', n);
    }
    console.log('Total docs:', summary.total);
    // Optionally write aux files even in COUNT_ONLY mode
    if (SEPARATE_AUX) {
      ensureDir(PUB_COUNTS_OUT);
      fs.writeFileSync(PUB_COUNTS_OUT, JSON.stringify(summary, null, 2));
      console.log(`📝 Publisher counts written: ${PUB_COUNTS_OUT}`);
      ensureDir(SKIPS_OUT);
      fs.writeFileSync(SKIPS_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sourcePath: IN, totalSkipped: skippedDocs.length, byPublisher: skippedByPublisher }, null, 2));
      console.log(`📝 Skipped docs report written: ${SKIPS_OUT}`);
    }
    if (COUNT_ONLY) return; // skip building the big index if we only wanted counts
  }

  const lineages = buildIndex(docs);
  attachVersionlessSuccessors(lineages);
  //attachInlineVersionless(lineages);
  const flagSummary = computeFlagSummary(lineages);
  const outObj = {
    generatedAt: new Date().toISOString(),
    sourcePath: IN,
    sourceHash: sha256File(IN),
    publisherCounts: pubCountsSummary,
    skippedDocs: {
      totalSkipped: skippedDocs.length,
      byPublisher: skippedByPublisher,
      summaryByReason: skippedSummary,
    },
    flagSummary,
    lineages
  };

  // Simple counts: found in source vs added to report
  const foundCount = docs.length;
  const addedCount = Array.isArray(lineages)
    ? lineages.reduce((acc, li) => acc + (Array.isArray(li.docs) ? li.docs.length : 0), 0)
    : 0;
  const skippedCount = Math.max(0, foundCount - addedCount);
  console.log(`\n📦 Found in source: ${foundCount}`);
  console.log(`🧩 Added to report: ${addedCount}`);
  console.log(`🕳️ Skipped (unkeyed/filtered): ${skippedCount}`);

  // Per-publisher breakdown: found vs added vs skipped
  const foundPerPub = {};
  for (const d of docs) {
    if (!d || !d.docId) continue;
    const pub = publisherFromDoc(d);
    foundPerPub[pub] = (foundPerPub[pub] || 0) + 1;
  }

  const addedPerPub = {};
  for (const li of Array.isArray(lineages) ? lineages : []) {
    const pub = (li && li.publisher) ? String(li.publisher).toUpperCase() : 'UNKNOWN';
    const n = Array.isArray(li.docs) ? li.docs.length : 0;
    addedPerPub[pub] = (addedPerPub[pub] || 0) + n;
  }

  const pubs = Array.from(new Set([...Object.keys(foundPerPub), ...Object.keys(addedPerPub)]));
  pubs.sort((a, b) => (addedPerPub[b]||0) - (addedPerPub[a]||0));

  // Optional: surface a few docIds that contributed to UNKNOWN for triage
  const unknownExamples = [];
  for (const d of docs) {
    if (!d || !d.docId) continue;
    if (publisherFromDoc(d) === 'UNKNOWN') {
      unknownExamples.push(d.docId);
      if (unknownExamples.length >= 5) break;
    }
  }
  if (unknownExamples.length) {
    console.log('\n⚠️  Example UNKNOWN publisher docIds (first 5):');
    for (const ex of unknownExamples) console.log('   ', ex);
  }

  console.log('\n📊 Per-publisher counts:');
  console.log('Publisher  Found  Added  Skipped');
  for (const p of pubs) {
    const f = foundPerPub[p] || 0;
    const a = addedPerPub[p] || 0;
    const s = Math.max(0, f - a);
    console.log(`${String(p).padEnd(10)} ${String(f).padStart(5)}  ${String(a).padStart(5)}  ${String(s).padStart(7)}`);
  }

  // Flag summary (top types by count)
  if (flagSummary && flagSummary.totalFlags) {
    // Build a sorted array of [type, {count, examples}]
    const sortedFlags = Object.entries(flagSummary.byType)
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));

    console.log('\n🚩 Flag summary:');
    console.log(`Total flags: ${flagSummary.totalFlags}`);
    for (const [type, info] of sortedFlags) {
      console.log(`- ${type.padEnd(32)} → ${String(info.count).padStart(4)}`);
    }
  } else {
    console.log('\n🚩 No inconsistency flags present.');
  }


  // Console list of skipped docIds per publisher (brief)
  if (!skippedDocs.length) {
    console.log('\n🧾 No skipped documents detected.');
  }

  // Optionally emit separate aux files only if SEPARATE_AUX is set
  if (SEPARATE_AUX) {
    ensureDir(PUB_COUNTS_OUT);
    fs.writeFileSync(PUB_COUNTS_OUT, JSON.stringify(pubCountsSummary, null, 2));
    console.log(`📝 Publisher counts written: ${PUB_COUNTS_OUT}`);
    ensureDir(SKIPS_OUT);
    fs.writeFileSync(SKIPS_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sourcePath: IN, totalSkipped: skippedDocs.length, byPublisher: skippedByPublisher }, null, 2));
    console.log(`📝 Skipped docs report written: ${SKIPS_OUT}`);
  }

  ensureDir(OUT);
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(outObj, null, 2));
  fs.renameSync(tmp, OUT);

  console.log(`\n✅ Master Suite Index written: ${OUT}`);
  console.log(`   Lineages: ${lineages.length}`);
})();