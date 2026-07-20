/*
 * extractFtxmlRefs.js — Todo #1 (apply half) of the canonical-audit handoff.
 *
 * ftxmlRefWalker.js cataloged 2,995 structured refs in the FTXML NLM full-text
 * XMLs but could not route them: their source articles did not exist in the
 * registry. PR #1241 ingested those 491 docs, so the refs can now be attached.
 * All 289 FTXML files resolve to a real doc and all 2,995 refs are attachable.
 *
 * SOURCE-DOC MAPPING — the subtle part. Map each FTXML file to its doc via the
 * SIBLING content_batch primary, NOT the FTXML's own <article-id>: conference
 * FTXML carry an EMPTY article DOI, so matching on it strands all 76 conference
 * papers. Sibling path is `.../FTXML/FT_<name>.xml` -> `.../<name>.xml`, and the
 * docId is then the same key the ingester minted (DOI->dash, else ISBN/ISSN +
 * article_sequence).
 *
 * RESOLUTION CHAIN per <ref> (Phase-3a pattern, extractSmpteJournalRefs.js):
 *   1. direct DOI      — <pub-id pub-id-type="doi">, exact case (never lowercase
 *                        a DOI join — canonical-audit rule)
 *   2. vol+pages       — SMPTE self-cites: (volume, first_page) against the
 *                        journal/conference corpus. Only UNAMBIGUOUS keys
 *                        resolve; multi-hit keys fall through to orphan-mint
 *                        rather than guess.
 *   3. mapRefByCite    — refMap.json canonical-form entries (curated, exact)
 *   4. orphan-slug     — content-hash pre-checked (#1229) MRI mint. Under MRI v2
 *                        these are first-class: cited from the source doc,
 *                        rendered with an EXTERNAL badge, carrying the raw XML +
 *                        citation text, and able to graduate later via
 *                        resolveOrphans without touching doc files.
 *
 * The #1229 content-hash pre-check: before minting, the raw <ref> XML is hashed
 * and checked against existing MRI entries. A hash that already resolved to a
 * canonical refId is reused as a direct link instead of minting a duplicate
 * orphan — this is the leaked-slug / twin-pair class from the Phase-3a cleanup.
 *
 * Targets are greenfield: all 491 ingested docs carry zero references, so this
 * only adds. Existing refs on any doc are never overwritten.
 *
 *   node …/extractFtxmlRefs.js            # dry-run -> report
 *   node …/extractFtxmlRefs.js --apply    # write docs + MRI
 *   node …/extractFtxmlRefs.js --limit 20 # cap to N source docs
 *
 * Reports: src/main/reports/smpte-canonical-audit/ftxmlRefApply.{json,md}
 */

const fs = require('fs');
const path = require('path');
const { loadAllDocs, saveDoc } = require('../../../lib/registry');
const {
  mapRefByCite,
  reloadRefMap,
  mriRecordSighting,
  mriFlush,
  mriEnsureFile,
  _contentHash,
} = require('../../../lib/referencing');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
process.chdir(REPO_ROOT);

const NOW = new Date().toISOString();
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  if (i < 0) return 0;
  const n = parseInt(process.argv[i + 1] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

const CATALOG = 'src/main/reports/smpte-canonical-audit/ftxmlRefCatalog.json';
const MRI_PATH = 'src/main/reports/masterReferenceIndex.json';
const OUT_JSON = 'src/main/reports/smpte-canonical-audit/ftxmlRefApply.json';
const OUT_MD = 'src/main/reports/smpte-canonical-audit/ftxmlRefApply.md';

// ---- XML helpers ---------------------------------------------------------
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
const strip = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
function tag(x, t) { const m = String(x).match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; }
const tagText = (x, t) => strip(tag(x, t));
function field(block, t) { const m = String(block).match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? strip(m[1]) : ''; }

// ---- registry + indices --------------------------------------------------
console.log('[ftxml-refs] loading registry…');
reloadRefMap();
mriEnsureFile();

const docs = loadAllDocs();
const byDocId = new Map(docs.map((d) => [d.docId, d]));
const docIds = new Set(docs.map((d) => d.docId));
// Exact-case DOI index — never lowercase a DOI join.
const byDoi = new Map();
for (const d of docs) if (d.doi) byDoi.set(String(d.doi).trim(), d);

// vol+pages self-cite index; ambiguous keys are recorded so we can refuse them.
const volPages = new Map();
for (const d of docs) {
  if (!/^10\.5594-[jJmM]/.test(d.docId || '')) continue;
  if (!d.volume || !d.pages) continue;
  const fp = String(d.pages).split(/[-–—]/)[0].trim();
  const key = `${String(d.volume).trim()}|${fp}`;
  if (!volPages.has(key)) volPages.set(key, []);
  volPages.get(key).push(d.docId);
}
console.log(`[ftxml-refs]   vol+pages index: ${volPages.size} keys`);

// #1229 content-hash pre-check — hash -> already-known canonical refId
const hashToRefId = new Map();
try {
  const mri = JSON.parse(fs.readFileSync(MRI_PATH, 'utf8'));
  for (const [refId, e] of Object.entries(mri.refs || {})) {
    if (e && e.contentHash && !e.isOrphan) hashToRefId.set(e.contentHash, refId);
  }
} catch (e) { console.warn(`[ftxml-refs]   MRI preload skipped: ${e.message}`); }
console.log(`[ftxml-refs]   content-hash pre-check entries: ${hashToRefId.size}`);

// ---- source-doc mapping (via the content_batch sibling) ------------------
function docForFtxml(ftxmlPath) {
  const sib = ftxmlPath.replace(/\/FTXML\/FT_/, '/');
  let xml; try { xml = fs.readFileSync(sib, 'utf8'); } catch { return null; }
  const isConf = /<conference_article\b/.test(xml);
  const art = tag(xml, isConf ? 'conference_article' : 'journal_article');
  if (!art) return null;

  const doi = tagText(art, 'doi');
  if (doi && byDoi.has(doi)) return byDoi.get(doi);

  const seq = tagText(art, 'article_sequence') || '0';
  if (isConf) {
    const isbn = tagText(tag(xml, 'conference_metadata'), 'isbn');
    return byDocId.get(`${isbn}-${seq}`) || null;
  }
  const meta = tag(xml, 'journal_metadata');
  const issn = (meta.match(/<issn[^>]*type="electronic"[^>]*>([^<]+)<\/issn>/i) || [])[1];
  const jv = tag(tag(xml, 'journal_issue'), 'journal_volume');
  return byDocId.get(`${issn}-v${tagText(jv, 'volume')}.${tagText(jv, 'issue')}-${seq}`) || null;
}

// ---- resolution chain ----------------------------------------------------
function isSmpteJournalSource(src) {
  const s = String(src || '').toLowerCase().trim();
  return /^journal$/.test(s) || /smp[te]|soc.*mot|trans.*mot/.test(s);
}

function resolve(rawRef) {
  // 1. direct DOI (exact case)
  const doi = (rawRef.match(/<pub-id[^>]*pub-id-type=["']doi["'][^>]*>([^<]+)<\/pub-id>/i) || [])[1];
  if (doi) {
    const t = doi.trim();
    if (byDoi.has(t)) return { kind: 'canonical', refId: byDoi.get(t).docId, via: 'direct-doi' };
    const dashed = t.replace(/\//g, '-');
    if (docIds.has(dashed)) return { kind: 'canonical', refId: dashed, via: 'direct-doi' };
  }

  const source = field(rawRef, 'source');
  const volume = field(rawRef, 'volume');
  const fpage = field(rawRef, 'fpage');
  const title = field(rawRef, 'article-title') || field(rawRef, 'chapter-title') || source;

  // 2. vol+pages SMPTE self-cite — unambiguous keys only
  if (volume && fpage && isSmpteJournalSource(source)) {
    const hits = volPages.get(`${volume.trim()}|${fpage.trim()}`);
    if (hits && hits.length === 1) return { kind: 'canonical', refId: hits[0], via: 'vol+pages' };
    if (hits && hits.length > 1) return { kind: 'orphan', via: 'vol+pages-ambiguous' };
  }

  // 3. curated refMap only. parseRefId is DELIBERATELY NOT USED here.
  //
  // It reads free text, and these FTXML refs are largely informal citations —
  // conference talks, vendor briefs, blog posts — whose titles merely MENTION a
  // standard. Auditing its output on this corpus showed it confidently wrong:
  //   · `SMPTE.ST2110` absorbed 9 distinct citations, mostly papers ABOUT
  //     ST 2110 ("Is SMPTE ST 2110 the future of your facility?").
  //   · `SMPTE.ST259` swallowed a citation to ST 297 — a different standard.
  //   · `ISO.23090` stood in for parts -3, -5 and -15 simultaneously, since the
  //     parse drops the part number that distinguishes them.
  // A volume+fpage "is this an article?" guard can't catch these, because talks
  // and web citations carry neither.
  //
  // Orphan slugs lose nothing by comparison: they keep the raw <ref> XML and the
  // citation text in the MRI and can graduate to a CORRECT canonical refId later
  // via resolveOrphans. A wrong canonical link, by contrast, is durable and
  // invisible. Precision over recall — same rule as never lowercasing a DOI join.
  if (title) {
    const mapped = mapRefByCite(title);
    if (mapped) return { kind: 'canonical', refId: mapped, via: 'mapRefByCite' };
  }

  // 5. #1229 content-hash pre-check before minting
  const h = _contentHash(rawRef);
  if (h && hashToRefId.has(h)) return { kind: 'canonical', refId: hashToRefId.get(h), via: 'content-hash' };

  return { kind: 'orphan', via: 'orphan-slug' };
}

// ---- walk the catalog ----------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const counters = { files: 0, sourceDocs: new Set(), refs: 0, canonical: 0, orphan: 0, inRegistry: 0, knownNoDoc: 0 };
const byVia = {};
const perDoc = new Map();   // docId -> ordered refIds/slugs
const unmapped = [];

for (const f of catalog.files) {
  if (LIMIT && counters.sourceDocs.size >= LIMIT) break;
  if (!f.refCount) continue;
  const doc = docForFtxml(f.path);
  if (!doc) { unmapped.push(f.path); continue; }
  counters.files++;
  counters.sourceDocs.add(doc.docId);

  let xml; try { xml = fs.readFileSync(f.path, 'utf8'); } catch { continue; }
  const refList = xml.match(/<ref-list\b[\s\S]*?<\/ref-list>/);
  if (!refList) continue;
  const rawRefs = refList[0].match(/<ref\b[^>]*>[\s\S]*?<\/ref>/g) || [];

  for (const raw of rawRefs) {
    counters.refs++;
    const r = resolve(raw);
    byVia[r.via] = (byVia[r.via] || 0) + 1;

    if (!perDoc.has(doc.docId)) perDoc.set(doc.docId, []);
    const bucket = perDoc.get(doc.docId);

    if (r.kind === 'canonical') {
      counters.canonical++;
      if (docIds.has(r.refId)) counters.inRegistry++; else counters.knownNoDoc++;
      if (APPLY) {
        try {
          mriRecordSighting({
            docId: doc.docId, type: 'bibliographic', refId: r.refId,
            cite: strip(raw.replace(/<ref\b[^>]*>|<\/ref>/g, '')), href: '',
            rawRef: raw, title: field(raw, 'article-title') || '',
            mapSource: 'ftxml-extract', mapDetail: r.via,
          });
        } catch (e) { console.warn(`[ftxml-refs] mri canonical failed ${doc.docId}/${r.refId}: ${e.message}`); }
      }
      if (!bucket.includes(r.refId)) bucket.push(r.refId);
      continue;
    }

    counters.orphan++;
    if (APPLY) {
      try {
        const mint = mriRecordSighting({
          docId: doc.docId, type: 'bibliographic',
          cite: strip(raw.replace(/<ref\b[^>]*>|<\/ref>/g, '')), href: '',
          rawRef: raw, title: field(raw, 'article-title') || '',
          mapSource: 'ftxml-extract', mapDetail: r.via,
        });
        const slug = mint && mint.mintedSlug;
        if (slug && !bucket.includes(slug)) bucket.push(slug);
      } catch (e) { console.warn(`[ftxml-refs] mint failed ${doc.docId}: ${e.message}`); }
    } else {
      // Dry-run: no slug is minted, but the per-doc totals must still reflect
      // what --apply would write, or the counts appear to jump on apply. The
      // mint is deterministic — `orphan/<docId>/<ref id>` — so project it.
      const refXmlId = (raw.match(/<ref\s+id="([^"]+)"/) || [])[1];
      const projected = `orphan/${doc.docId}/${refXmlId || `h:${String(_contentHash(raw)).slice(0, 8)}`}`;
      if (!bucket.includes(projected)) bucket.push(projected);
    }
  }
}

// ---- write ---------------------------------------------------------------
let docsWritten = 0;
if (APPLY) {
  for (const [docId, refs] of perDoc) {
    const doc = byDocId.get(docId);
    if (!doc || !refs.length) continue;
    doc.references = doc.references || {};
    const existing = Array.isArray(doc.references.bibliographic) ? doc.references.bibliographic : [];
    const merged = [...existing];
    for (const r of refs) if (!merged.includes(r)) merged.push(r);
    doc.references.bibliographic = merged;
    doc.references['bibliographic$meta'] = {
      source: 'parsed', confidence: 'medium',
      note: 'Extracted from the FTXML NLM <back><ref-list> via extractFtxmlRefs.js (source doc mapped through its content_batch sibling).',
      updated: NOW,
    };
    saveDoc(doc);
    docsWritten++;
  }
  console.log('[ftxml-refs] flushing MRI…');
  mriFlush({ force: true });
}

const summary = {
  generatedAt: NOW, apply: APPLY, limit: LIMIT || null,
  totals: {
    ftxmlFilesWithRefs: counters.files,
    sourceDocsTouched: counters.sourceDocs.size,
    refsProcessed: counters.refs,
    canonical: counters.canonical,
    canonicalInRegistry: counters.inRegistry,
    canonicalKnownNoDoc: counters.knownNoDoc,
    orphanSlugs: counters.orphan,
    docsWritten,
    unmappedFiles: unmapped.length,
  },
  byVia,
  perDoc: [...perDoc.entries()].map(([docId, refs]) => ({ docId, refCount: refs.length })),
};
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');

const md = [
  '# FTXML reference apply — backfill onto the 491 ingested docs\n',
  `> ${APPLY ? 'APPLY' : 'DRY-RUN'} · ${NOW}${LIMIT ? ` · limit ${LIMIT}` : ''}\n`,
  '## Totals',
  `- FTXML files with refs      : ${counters.files}`,
  `- source docs touched        : **${counters.sourceDocs.size}**`,
  `- refs processed             : **${counters.refs}**`,
  `- → canonical refId (direct link) : **${counters.canonical}** (${counters.inRegistry} resolve to a registry doc)`,
  `- → orphan slug (MRI, EXTERNAL badge) : **${counters.orphan}**`,
  `- unmapped FTXML files       : ${unmapped.length}`,
  `- docs written               : ${docsWritten}\n`,
  '## By resolution path',
  '| path | refs |',
  '|---|---:|',
  ...Object.entries(byVia).sort(([, a], [, b]) => b - a).map(([k, v]) => `| \`${k}\` | ${v} |`),
  '',
  '## Notes',
  '- Source docs are mapped through the **content_batch sibling**, not the FTXML `<article-id>`:',
  '  conference FTXML carry an empty article DOI, so an FTXML-DOI match strands all 76 of them.',
  '- `vol+pages` resolves SMPTE self-cites only on **unambiguous** keys; multi-hit keys fall through',
  '  to an orphan mint rather than guessing.',
  '- Orphan slugs are not silent: they render as `<cite>` with an EXTERNAL badge, carry the raw XML +',
  '  citation text in the MRI, and graduate to canonical refIds later via `resolveOrphans` with no',
  '  doc-file edits.',
  '- Targets were greenfield (0 of 491 carried references); existing refs are merged, never replaced.\n',
].join('\n');
fs.writeFileSync(OUT_MD, md, 'utf8');

console.log(`\n[ftxml-refs] ${APPLY ? 'APPLIED' : 'DRY-RUN'}`);
console.log(`  source docs touched : ${counters.sourceDocs.size}`);
console.log(`  refs processed      : ${counters.refs}`);
console.log(`  canonical links     : ${counters.canonical} (${counters.inRegistry} in registry)`);
console.log(`  orphan slugs        : ${counters.orphan}`);
console.log(`  reports             : ${OUT_JSON}, ${OUT_MD}`);
if (!APPLY) console.log('\n  re-run with --apply to write docs + MRI.');
