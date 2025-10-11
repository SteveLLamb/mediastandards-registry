const fs = require('fs');

// Source registry snapshot used for stats
const docsPath = 'src/main/data/documents.json';
const documents = JSON.parse(fs.readFileSync(docsPath, 'utf8'));

// Basic counts
const totalDocs = documents.length;
const activeDocs = documents.filter(d => d?.status?.active === true).length;
const supersededDocs = documents.filter(d => d?.status?.superseded === true).length;

// Reference counts (normative + bibliographic)
const references = documents.reduce((sum, d) => {
  const normative = Array.isArray(d.references?.normative) ? d.references.normative.length : 0;
  const bibliographic = Array.isArray(d.references?.bibliographic) ? d.references.bibliographic.length : 0;
  return sum + normative + bibliographic;
}, 0);

// Publisher stats (unique count)
const publishers = new Set(
  documents
    .map(d => (typeof d.publisher === 'string' && d.publisher.trim().length ? d.publisher.trim() : null))
    .filter(Boolean)
).size;

// docType distribution (grouped counts)
const docsByType = documents.reduce((acc, d) => {
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
    references,
    publishers,
    active: activeDocs,
    //superseded: supersededDocs,
    docTypes: Object.keys(docsByType).length,
    docsByType
  }
};

// Write to the API stats file (consumed by site as /api/stats.json)
const outPath = 'build/api/stats.json';
fs.mkdirSync('build/api', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));