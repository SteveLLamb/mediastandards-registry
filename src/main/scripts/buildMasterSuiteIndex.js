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
  // Matches W3C.<short>.<YYYYMMDD|YYYY|YYYY-MM|LATEST>
  const m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?|LATEST)$/i);
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
    return d.publisher.trim().toUpperCase();
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

// Collect skipped (unkeyed or filtered) docs for reporting
function collectSkipped(allDocs) {
  const skipped = [];
  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    // Apply global aliases for skipped/added parity
    applyGlobalAliases(d);
    // Normalize W3C like buildIndex does to keep parity
    normalizeW3C(d);
    const k = keyFromDocId(d.docId, d);
    if (!k) {
      skipped.push({ docId: d.docId, publisher: publisherFromDoc(d), reason: 'UNKEYED' });
      continue;
    }
    if (shouldSkipKey(k)) {
      skipped.push({ docId: d.docId, publisher: publisherFromDoc(d), reason: 'FILTERED', key: [k.publisher, k.suite || '', k.number, k.part || ''].join('|') });
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

  return smpteAm.test(docId) || isoIecAmCor.test(docId) || nistSpInline.test(docId) || nistSpHyphen.test(docId);
}


function dateKeyFromDoc(d) {
  // Priority: releaseTag (YYYYMMDD-...), then publicationDate (YYYY-MM-DD),
  // then docId suffix: .YYYYMMDD | .YYYY-MM | .YYYY
  if (typeof d.releaseTag === 'string' && /^\d{8}/.test(d.releaseTag)) {
    return d.releaseTag.slice(0, 8);
  }
  if (typeof d.publicationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.publicationDate)) {
    return d.publicationDate.replace(/-/g, '');
  }
  // Accept 8-digit date (W3C REC shortname style), or year-month, or just year at end of docId
  const m8 = d.docId && d.docId.match(/\.([12]\d{7})$/); // .YYYYMMDD
  if (m8) return m8[1];
  // .YYYY-MM-DD  → YYYYMMDD
  const mYMDdash = d.docId && d.docId.match(/\.([12]\d{3})-(\d{2})-(\d{2})$/);
  if (mYMDdash) return `${mYMDdash[1]}${mYMDdash[2]}${mYMDdash[3]}`;
  // .YYYY- MMDD  (e.g., 2012-1010, 2020-0714) → YYYYMMDD
  const mY_MMD = d.docId && d.docId.match(/\.([12]\d{3})-(\d{4})$/);
  if (mY_MMD) return `${mY_MMD[1]}${mY_MMD[2]}`;
  const mYM = d.docId && d.docId.match(/\.([12]\d{3})-(\d{2})$/); // .YYYY-MM
  if (mYM) return `${mYM[1]}${mYM[2]}`;
  const mY = d.docId && d.docId.match(/\.([12]\d{3})$/); // .YYYY
  if (mY) return `${mY[1]}00`;
  return '00000000'; // last-resort floor
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
  // Special-case: SMPTE RP series with inline edition token `v##` (treat as RP family, no part)
  // Examples:
  //   SMPTE.RP224v12.2012    → RP 224, part: null (edition 12)
  //   SMPTE.RP210v13.2012    → RP 210, part: null (edition 13)
  // We normalize these to avoid creating fake parts from the `v##` token.
  let m = docId.match(/^SMPTE\.RP(\d+)v\d+\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    return { publisher: 'SMPTE', suite: 'RP', number: m[1], part: null };
  }
  // SMPTE OM sub-suites without numeric series, e.g., SMPTE.OM.Std.LATEST, SMPTE.OM.BL.20240101
  m = docId.match(/^SMPTE\.OM\.([A-Za-z][A-Za-z0-9-]*)\.(?:LATEST|\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) {
    // Treat the token after OM as the lineage "number" slot so Std and BL live in distinct buckets
    return { publisher: 'SMPTE', suite: 'OM', number: m[1], part: null };
  }
  // SMPTE.ST429-6.2023-05 -> {publisher:"SMPTE", suite:"ST", number:"429", part:"6"}
  m = docId.match(/^SMPTE\.(OM|AG|ST|RP|EG|RDD|OV)(\d+[A-Za-z]*)(?:-(\d+))?\./i);
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

  // ISO / IEC series with optional (possibly composite) part token
  // Examples:
  //   IEC.61966-2-1.1999  -> number: 61966, part: 2-1
  //   IEC.60268-3.2018    -> number: 60268, part: 3
  //   ISO.8601-1.2019     -> number: 8601,  part: 1
  m = docId.match(/^(ISO(?:\.IEC)?|IEC)\.(\d+)(?:-([0-9-]+))?\./i);
  if (m) {
    return { publisher: m[1].toUpperCase(), suite: null, number: m[2], part: m[3] || null };
  }

  // W3C shortnames: W3C.shortname.YYYYMMDD, W3C.shortname.YYYY, W3C.shortname.YYYY-MM, or W3C.shortname.LATEST
  // e.g., W3C.xmlschema-1.20041028, W3C.xmldsig-core1.LATEST, W3C.rddl.2002, W3C.rddl.2010, W3C.rddl.2010-03
  m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?|LATEST)$/i);
  if (m) {
    // If we already normalized W3C fields on the full doc, prefer those for stable keying
    if (doc._w3c && doc._w3c.family) {
      return { publisher: 'W3C', suite: doc._w3c.family, number: doc._w3c.version || null, part: null };
    }
    const suiteToken = m[1];
    // Try to detect a version-style numeric suffix (e.g., "1.0.1", "1.1", "3.1") and treat as number
    // Accepts trailing numeric segments separated by [._-]
    const versionMatch = suiteToken.match(/^(.*?)(?:[._-]?(\d+(?:\.\d+)*))$/);
    if (versionMatch && versionMatch[2]) {
      // Only treat as version if the match is not the whole string (i.e., there is a prefix)
      // and the suffix is a plausible version (has at least one dot or is at end)
      // Also, ensure that the prefix is not empty (avoiding e.g., "1.2" → prefix "")
      if (versionMatch[1] && versionMatch[2]) {
        return { publisher: 'W3C', suite: versionMatch[1], number: versionMatch[2], part: null };
      }
    }
    return { publisher: 'W3C', suite: suiteToken, number: null, part: null };
  }

  // IETF RFC: rfcXXXX (any case). Normalize to publisher IETF, suite RFC, number = digits
  m = docId.match(/^rfc(\d+)$/i);
  if (m) {
    return { publisher: 'IETF', suite: 'RFC', number: m[1], part: null };
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
  m = docId.match(/^DCI\.DCSS\.(v\d+(?:\.\d+)*?)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) {
    return { publisher: 'DCI', suite: 'DCSS', number: null, part: null };
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

  // IANA registries (as used in refs): e.g., IANA.LanguageSubtagRegistry.LATEST
  //m = docId.match(/^IANA\.([A-Za-z][A-Za-z0-9._-]*)\.(?:LATEST|\d{8}|\d{4}(?:-\d{2})?)$/i);
  //if (m) {
  //  return { publisher: 'IANA', suite: m[1], number: null, part: null };
  //}

  // MovieLabs Ratings: MovieLabs.Ratings.LATEST
  //m = docId.match(/^MovieLabs\.Ratings\.(?:LATEST|\d{4}(?:-\d{2})?)$/i);
  //if (m) {
  //  return { publisher: 'MovieLabs', suite: 'Ratings', number: null, part: null };AG
  //}

  // UN M49: UN.M49.LATEST
  //m = docId.match(/^UN\.M49\.(?:LATEST|\d{4}(?:-\d{2})?)$/i);
  //if (m) {
  //  return { publisher: 'UN', suite: 'M49', number: null, part: null };
  //}

  // Unknown / not indexed here
  return null;
}

function shouldSkipKey(k) {
  // No publisher/suite is skipped unconditionally.
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
    const releaseTag = typeof d.releaseTag === 'string' ? d.releaseTag : null;

    map.get(keyStr).docs.push({
      docId: d.docId,
      publicationDate: d.publicationDate || null,
      releaseTag,
      statusActive,
      statusSuperseded,
      statusWithdrawn,
      statusStabilized,
      statusAmended,
      _dk: dateKeyFromDoc(d),
      _isBase: !isAmendmentDocId(d.docId),
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
      statusAmended: x.statusAmended
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
      counts: { bases: bases.length, amendments: entry.docs.length - bases.length }
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
    if (!skippedByPublisher[pub]) skippedByPublisher[pub] = { count: 0, docIds: [] };
    skippedByPublisher[pub].count++;
    skippedByPublisher[pub].docIds.push(s.docId);
  }

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
  const flagSummary = computeFlagSummary(lineages);
  const outObj = {
    generatedAt: new Date().toISOString(),
    sourcePath: IN,
    sourceHash: sha256File(IN),
    publisherCounts: pubCountsSummary,
    skippedDocs: {
      totalSkipped: skippedDocs.length,
      byPublisher: skippedByPublisher
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