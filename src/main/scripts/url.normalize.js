const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DATA_DIR = 'src/main/data';
const REPORT_DIR = 'src/main/reports';
const AUDIT_PATH = path.join(REPORT_DIR, 'url_validate_audit.json');
const DOCS_PATH = path.join(DATA_DIR, 'documents.json');
const COMBINED_PATH = path.join(REPORT_DIR, 'url_validate_normalize.json');

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inferPublisher(entry) {
  return (entry && entry.publisher) || '';
}

function setWithMeta(obj, key, value, meta) {
  obj[key] = value;
  obj[`${key}$meta`] = {
    confidence: meta.confidence || 'high',
    originalValue: null,
    note: 'Backfilled from url.validate report #resolvedHref',
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

  // Audit format (grouped): { generatedAt, target, ..., report: { redirect: { undefined: [ { docId, field, resolvedUrl, resolvedField? } ] } } }
  // Consume grouped report: look only at redirect.undefined entries
  const redirectUndefined = (audit && audit.report && audit.report.redirect && Array.isArray(audit.report.redirect.undefined))
    ? audit.report.redirect.undefined
    : [];

  for (const p of redirectUndefined) {
    const docId = p.docId;
    const doc = byDocId.get(docId);
    if (!doc) continue;

    const field = p.field; // e.g., 'href'
    const resolvedField = p.resolvedField || `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`; // e.g., 'resolvedHref'

    considered++;
    eligible++; // by definition of this bucket

    // Prefer validator's resolvedUrl; fall back to the document's current field value
    const candidate = p.resolvedUrl || doc[field];
    if (!candidate) continue;

    const existing = doc[resolvedField];
    // If already set to the same value, skip applying but still count as backfillable candidate
    const finalUrl = candidate;
    const finalRule = 'resolved';

    backfillable++;
    // Only record and write when it actually changes the document
    if (existing !== finalUrl) {
      proposals.push({ docId, field: resolvedField, old: existing ?? null, new: finalUrl, rule: finalRule });
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

try { main(); } catch (e) { console.error(`❌ url.normalize failed: ${e.message}`); process.exit(1); }
