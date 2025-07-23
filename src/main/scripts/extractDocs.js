const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');

const urls = require('../input/urls.json');
const badRefs = [];

const parseRefId = (text, href = '') => {
  if (/w3\.org\/TR\/\d{4}\/REC-([^\/]+)-(\d{8})\//i.test(href)) {
    const [, shortname, yyyymmdd] = href.match(/REC-([^\/]+)-(\d{8})/i);
    return `${shortname}.${yyyymmdd}`;
  }
  if (/w3\.org\/TR\/([^\/]+)\/?$/i.test(href)) {
    const [, shortname] = href.match(/w3\.org\/TR\/([^\/]+)\/?$/i);
    return `${shortname}.LATEST`;
  }
  const parts = text.split('|').map(p => p.trim());
  text = parts.find(p => /ISO\/IEC|ISO/.test(p)) || parts[0];
  if (/SMPTE\s+(ST|RP|RDD)\s+(\d+)(-(\d+))?/.test(text)) {
    const [, type, num, , part] = text.match(/SMPTE\s+(ST|RP|RDD)\s+(\d+)(-(\d+))?/);
    return `SMPTE.${type}${part ? `${num}-${part}` : num}.LATEST`;
  }
  if (/RFC\s*(\d+)/i.test(text)) {
    return `rfc${text.match(/RFC\s*(\d+)/i)[1]}`;
  }
  if (/10\.6028\/NIST\.(.+)/i.test(href)) {
    const [, id] = href.match(/10\.6028\/NIST\.(.+)/i);
    return `NIST.${id}`;
  }
  if (/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `ISO.${base}${year ? `.${year}` : '.LATEST'}`;
  }
  if (/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `ISO.${base}${year ? `.${year}` : '.LATEST'}`;
  }
  if (/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    return `IEC.${base}${year ? `.${year}` : '.LATEST'}`;
  }
  if (/Language Subtag Registry/i.test(text)) return 'IANA.LanguageSubtagRegistry.LATEST';
  if (/Digital Cinema Naming/i.test(text)) return 'ISDCF.DCNC.LATEST';
  if (/Common Metadata Ratings/i.test(text)) return 'MovieLabs.Ratings.LATEST';
  if (/UN/i.test(text)) return 'UN.M49.LATEST';
  return null;
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
  const pubStage = $('[itemprop="pubStage"]').attr('content') || '';
  const pubState = $('[itemprop="pubState"]').attr('content') || '';
  const isActive = pubStage.toUpperCase() === 'PUB' && pubState.toLowerCase() === 'pub';
  const pubDateObj = dayjs(pubDate);
  const dateFormatted = pubDateObj.format('YYYY-MM-DD');
  const dateShort = pubDateObj.format('YYYY-MM');

  const typeMap = {
    AG: 'Administrative Guideline',
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
      if (refId) {
        refSections[type].push(refId);
      } else {
        badRefs.push({
          docId: id,
          type,
          refText,
          href
        });
      }
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
    status: { active: isActive },
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

  for (const doc of results) {
    const index = existingDocs.findIndex(d => d.docId === doc.docId);
    if (index === -1) {
      newDocs.push(doc);
      existingDocs.push(doc);
    } else {
      const existingDoc = existingDocs[index];
      let changedFields = [];
      const oldRefs = existingDoc.references || { normative: [], bibliographic: [] };
      const newRefs = doc.references;

      // Capture the old values before updating
      const oldValues = { ...existingDoc };
      // Capture the new values for logging
      const newValues = {};  

      // Add new references
      const addedRefs = {
        normative: newRefs.normative.filter(ref => !oldRefs.normative.includes(ref)),
        bibliographic: newRefs.bibliographic.filter(ref => !oldRefs.bibliographic.includes(ref))
      };

      // Remove outdated references
      const removedRefs = {
        normative: oldRefs.normative.filter(ref => !newRefs.normative.includes(ref)),
        bibliographic: oldRefs.bibliographic.filter(ref => !newRefs.bibliographic.includes(ref))
      };

      existingDoc.references = newRefs;

      // Update document fields if there are changes
      for (const key of Object.keys(doc)) {
        const oldVal = oldValues[key];  // Use old captured value
        const newVal = doc[key];

        // Save the new value for later use in the log
        newValues[key] = newVal;

        const isEqual = typeof newVal === 'object'
          ? JSON.stringify(oldVal) === JSON.stringify(newVal)
          : oldVal === newVal;

        if (!isEqual) {
          // Skip references logging in field updates
          if (key !== 'references') {
            existingDoc[key] = newVal;  // Now update the value
            changedFields.push(key);

          }
        }
      }

      // If any fields or references were changed
      if (changedFields.length > 0 || addedRefs.normative.length || addedRefs.bibliographic.length || removedRefs.normative.length || removedRefs.bibliographic.length) {
        updatedDocs.push({
          docId: doc.docId,
          fields: changedFields,
          addedRefs,
          removedRefs,
          oldValues, // Include old values in the update log
          newValues, // Include new values in the update log
        });
      } else {
        skippedDocs.push(doc.docId);
      }
    }
  }

  // Sort documents by docId
  existingDocs.sort((a, b) => a.docId.localeCompare(b.docId));

  // Write sorted documents to file
  fs.writeFileSync(
    outputPath,
    JSON.stringify(existingDocs, null, 2) + '\n'
  );

  console.log(`✅ Added ${newDocs.length} new documents.`);
  console.log(`🔁 Updated ${updatedDocs.length} documents.`);
  console.log(`⚠️ Skipped ${skippedDocs.length} duplicates.`);

  if (newDocs.length === 0 && updatedDocs.length === 0) {
    console.log('ℹ️ No new or updated documents — skipping PR creation.');
    fs.writeFileSync('skip-pr-flag.txt', 'true');
    process.exit(0);
  }

  const prLines = [
    `### 🆕 Added ${newDocs.length} new document(s):`,
    ...newDocs.map(doc => `- ${doc.docId}`),
    '',
    `### 🔁 Updated ${updatedDocs.length} existing document(s):`,
    ...updatedDocs.flatMap(doc => {
      const lines = [`- ${doc.docId} (updated fields: ${doc.fields.join(', ')})`];

      // Log field updates with old and new values
      doc.fields.forEach(field => {
        const oldVal = doc.oldValues[field];  // Use the old captured value
        const newVal = doc.newValues[field];  // Use the new value
        lines.push(`  - ${field}: "${oldVal}" > "${newVal}"`);
      });

      // Log added references
      const norm = doc.addedRefs.normative;
      const bibl = doc.addedRefs.bibliographic;
      if (norm.length || bibl.length) {
        if (norm.length) lines.push(`  - ➕ Normative Ref(s) added:\r\n ${norm.join('\r')}`);
        if (bibl.length) lines.push(`  - ➕ Bibliographic Ref(s) added:\r\n ${bibl.join('\r')}`);
      }

      // Log removed references
      if (doc.removedRefs.normative.length || doc.removedRefs.bibliographic.length) {
        if (doc.removedRefs.normative.length) lines.push(`  - ➖ Normative Ref(s) removed:\r\n ${doc.removedRefs.normative.join('\r')}`);
        if (doc.removedRefs.bibliographic.length) lines.push(`  - ➖ Bibliographic Ref(s) removed:\r\n ${doc.removedRefs.bibliographic.join('\r')}`);
      }
      return lines;
    }),
    '',
    `### ⚠️ Skipped ${skippedDocs.length} duplicate(s):`,
    ...skippedDocs.map(id => `- ${id}`),
    ''
  ];

  fs.writeFileSync('pr-update-log.txt', prLines.join('\n'));

  if (badRefs.length > 0) {
    const lines = ['### 🚫 Unparseable References Found:\n'];
    badRefs.forEach(ref => {
      lines.push(`- From ${ref.docId} (${ref.type}):`);
      lines.push(`  - cite: ${ref.refText}`);
      if (ref.href) lines.push(`  - href: ${ref.href}`);
    });

    fs.appendFileSync('pr-update-log.txt', '\n' + lines.join('\n') + '\n');
  }

})();
