
/* URL Validation Enrichment — backfill expected resolved* fields
 *
 * Usage:
 *   node src/main/scripts/url.enrich.js [--apply]
 *
 * Inputs:
 *   - src/main/reports/url_validate_audit.json
 *   - src/main/data/documents.json
 *
 * Outputs:
 *   - src/main/reports/url_validate_backfill_patch.json (proposals)
 *   - src/main/reports/url_validate_enrich_summary.json (counts)
 *   - (when --apply) in-place updates to documents.json with resolved* and $meta
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DATA_DIR = 'src/main/data';
const REPORT_DIR = 'src/main/reports';
const AUDIT_PATH = path.join(REPORT_DIR, 'url_validate_audit.json');
const DOCS_PATH = path.join(DATA_DIR, 'documents.json');
const COMBINED_PATH = path.join(REPORT_DIR, 'url_validate_enrich_report.json');

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inferPublisher(entry) {
  return (entry && (entry.publisher || entry.publisherName || entry.org || entry.organization)) || '';
}

function setWithMeta(obj, key, value, meta) {
  obj[key] = value;
  obj[`${key}$meta`] = {
    note: 'Backfilled from url.validate report #resolvedHref',
    confidence: meta.confidence || 'high',
    source: meta.rule || undefined,
    updated: new Date().toISOString()
  };
}

function main() {
  const audit = loadJson(AUDIT_PATH);
  const docs = loadJson(DOCS_PATH);

  // Build index by docId for quick lookup
  const byDocId = new Map();
  for (const d of docs) {
    if (d && d.docId) byDocId.set(d.docId, d);
  }

  const proposals = [];
  let considered = 0;
  let eligible = 0; // redirect with undefined expected
  let backfillable = 0;
  let applied = 0;

  // Audit format: { generatedAt, target, ..., report: [ { "<key>": [ problems... ] }, ... ] }
  const items = Array.isArray(audit.report) ? audit.report : [];

  for (const bucket of items) {
    const key = Object.keys(bucket)[0];
    const problems = bucket[key];
    if (!Array.isArray(problems)) continue;

    // Only handle documents.json entries for now
    const doc = byDocId.get(key);
    if (!doc) continue;

    for (const p of problems) {
      if (p.type !== 'redirect') continue;

      const field = p.field; // e.g., 'href'
      const resolvedField = `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`; // e.g., 'resolvedHref'

      // Only backfill when expected was undefined per validator output
      const wasUndefined = (p[resolvedField] === 'undefined' || p[resolvedField] === undefined);
      considered++;
      if (!wasUndefined) continue;
      eligible++;

      // Prefer the validator's resolvedUrl if present; otherwise fall back to the original field
      const candidate = p.resolvedUrl || doc[field];
      if (!candidate) continue;

      // Use the validator's resolvedUrl as the source of truth; fall back to the original field value
      const finalUrl = candidate;
      const finalRule = 'resolved';

      backfillable++;
      proposals.push({ docId: doc.docId, field: resolvedField, old: null, new: finalUrl, rule: finalRule });
      if (APPLY) {
        setWithMeta(doc, resolvedField, finalUrl, { rule: finalRule });
        applied++;
      }
    }
  }

  // Write single combined report
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const combined = {
    generatedAt: new Date().toISOString(),
    applyMode: APPLY,
    considered,
    eligible,
    backfillable,
    applied,
    proposals
  };
  fs.writeFileSync(COMBINED_PATH, JSON.stringify(combined, null, 2));

  if (APPLY) {
    fs.writeFileSync(DOCS_PATH, JSON.stringify(docs, null, 2));
    console.log(`✅ Applied ${applied} backfills to ${DOCS_PATH}`);
  }
  console.log(`🧾 Enrich report → ${COMBINED_PATH} (backfillable: ${backfillable}, eligible: ${eligible}, considered: ${considered})`);
}

try { main(); } catch (e) { console.error(`❌ url.enrich failed: ${e.message}`); process.exit(1); }
