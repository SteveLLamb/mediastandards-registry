const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');

const urls = require('../input/urls.json');

const parseRefId = (text, href = '') => {
  // ... (existing refId parsing code)
};

const extractFromUrl = async (url) => {
  const res = await axios.get(url);
  const $ = cheerio.load(res.data);

  const pubType = $('[itemprop="pubType"]').attr('content');
  const pubNumber = $('[itemprop="pubNumber"]').attr('content');
  const pubPart = $('[itemprop="pubPart"]').attr('content');
  const pubDate = $('[itemprop="pubDateTime"]').attr('content');
  const suiteTitle = $('[itemprop="pubSuiteTitle"]').attr('content');
  const title = $('title').text().trim();
  const tc = $('[itemprop="pubTC"]').attr('content');

  const pubDateObj = dayjs(pubDate);
  const dateFormatted = pubDateObj.format('YYYY-MM-DD');
  const dateShort = pubDateObj.format('YYYY-MM');

  const typeMap = {
    ST: 'Standard',
    RP: 'Recommended Practice',
    EG: 'Engineering Guideline',
    RDD: 'Registered Disclosure Document',
    OV: 'Overview Document'
  };

  const docType = typeMap[pubType.toUpperCase()] || pubType;
  const label = `SMPTE ${pubType} ${pubNumber}-${pubPart}:${dateShort}`;
  const id = `SMPTE.${pubType}${pubNumber}-${pubPart}.${dateShort}`;
  const doi = `10.5594/SMPTE.${pubType}${pubNumber}-${pubPart}.${pubDateObj.format('YYYY')}`;
  const href = `https://doi.org/${doi}`;

  const refSections = { normative: [], bibliographic: [] };
  ['normative-references', 'bibliography'].forEach((sectionId) => {
    const type = sectionId.includes('normative') ? 'normative' : 'bibliographic';
    $(`#sec-${sectionId} ul li`).each((_, el) => {
      const cite = $(el).find('cite');
      const refText = cite.text();
      const href = $(el).find('a.ext-ref').attr('href') || '';
      const refId = parseRefId(refText, href);
      if (refId) refSections[type].push(refId);
    });
  });

  return {
    docId: id,
    docLabel: label,
    docNumber: pubNumber,
    docPart: pubPart,
    docTitle: `${suiteTitle} ${title}`,
    docType: docType,
    doi: doi,
    group: `smpte-${tc.toLowerCase()}-tc`,
    publicationDate: dateFormatted,
    publisher: 'SMPTE',
    href: href,
    status: { active: true },
    references: refSections
  };
};

(async () => {
  const results = [];
  for (const url of urls) {
    try {
      const doc = await extractFromUrl(url);
      results.push(doc);
    } catch (e) {
      console.error(`Failed to process ${url}:`, e.message);
    }
  }

  const outputPath = 'src/main/output/documents.json';
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

  for (const doc of results) {
    const index = existingDocs.findIndex(d => d.docId === doc.docId);
    if (index === -1) {
      newDocs.push(doc);
      existingDocs.push(doc);
    } else {
      const existingDoc = existingDocs[index];
      let changedFields = [];
      const fieldChanges = [];

      const oldRefs = existingDoc.references || { normative: [], bibliographic: [] };
      const newRefs = doc.references;
      const addedRefs = {
        normative: newRefs.normative.filter(ref => !oldRefs.normative.includes(ref)),
        bibliographic: newRefs.bibliographic.filter(ref => !oldRefs.bibliographic.includes(ref)),
      };

      // Iterate through all fields and check for changes
      for (const key of Object.keys(doc)) {
        const oldVal = existingDoc[key];
        const newVal = doc[key];
        const isEqual = typeof newVal === 'object'
          ? JSON.stringify(oldVal) === JSON.stringify(newVal)
          : oldVal === newVal;

        if (!isEqual) {
          existingDoc[key] = newVal;
          fieldChanges.push(key);
        }
      }

      if (fieldChanges.length > 0) {
        updatedDocs.push({ docId: doc.docId, fields: fieldChanges, addedRefs });
      } else {
        skippedDocs.push(doc.docId);
      }
    }
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify({ _generated: new Date().toISOString(), documents: existingDocs }, null, 2) + '\n'
  );

  console.log(`✅ Added ${newDocs.length} new documents.`);
  console.log(`🔁 Updated ${updatedDocs.length} documents.`);
  console.log(`⚠️ Skipped ${skippedDocs.length} duplicates.`);

  // Log the PR summary
  const prLines = [
    `### 🆕 Added ${newDocs.length} new document(s):`,
    ...newDocs.map(doc => `- ${doc.docId}`),
    '',
    `### 🔁 Updated ${updatedDocs.length} existing document(s):`,
    ...updatedDocs.flatMap(doc => {
      const lines = [`- ${doc.docId} (updated fields: ${doc.fields.join(', ')})`];
      const norm = doc.addedRefs.normative;
      const bibl = doc.addedRefs.bibliographic;
      if (norm.length || bibl.length) {
        if (norm.length) lines.push(`  - ➕ Normative Ref added: ${norm.join(', ')}`);
        if (bibl.length) lines.push(`  - ➕ Bibliographic Ref added: ${bibl.join(', ')}`);
      }
      return lines;
    }),
    '',
    `### ⚠️ Skipped ${skippedDocs.length} duplicate(s):`,
    ...skippedDocs.map(id => `- ${id}`),
    ''
  ];

  fs.writeFileSync('pr-update-log.txt', prLines.join('\n'));
})();
