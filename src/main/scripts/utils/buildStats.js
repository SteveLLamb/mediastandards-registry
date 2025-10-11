const fs = require('fs');

// Source registry snapshot used for stats
const docsPath = 'src/main/data/documents.json';
const documents = JSON.parse(fs.readFileSync(docsPath, 'utf8'));

// Basic counts
const totalDocs = documents.length;
const activeDocs = documents.filter(d => d?.status?.active === true).length;
const supersededDocs = documents.filter(d => d?.status?.superseded === true).length;

// Reference counts (normative + bibliographic)
const totalReferences = documents.reduce((sum, d) => {
  const normative = Array.isArray(d.references?.normative) ? d.references.normative.length : 0;
  const bibliographic = Array.isArray(d.references?.bibliographic) ? d.references.bibliographic.length : 0;
  return sum + normative + bibliographic;
}, 0);

// Publisher stats (unique count)
const totalPublishers = new Set(
  documents
    .map(d => (typeof d.publisher === 'string' && d.publisher.trim().length ? d.publisher.trim() : null))
    .filter(Boolean)
).size;

// docType distribution (grouped counts)
const byDocType = documents.reduce((acc, d) => {
  const key = (typeof d.docType === 'string' && d.docType.trim().length) ? d.docType.trim() : 'Unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

// Compose stats object
const stats = {
  generatedAt: new Date().toISOString(),

  // New structured top-level bucket to allow future siblings (e.g., "namespaces", "references", etc.)
  documents: {
    total: totalDocs,
    totalReferences,
    totalPublishers,
    active: activeDocs,
    //superseded: supersededDocs,
    totalDocTypes: Object.keys(byDocType).length,
    byDocType
  }
};

// Write to the API stats file (consumed by site as /api/stats.json)
const outPath = 'src/main/reports/api_stats.json';
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));