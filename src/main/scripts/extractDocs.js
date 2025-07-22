const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');

const urls = require('../input/urls.json');

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
  if (/Language Subtag Registry/i.test(text)) {
    return 'IANA.LanguageSubtagRegistry.LATEST';
  }
  if (/Digital Cinema Naming/i.test(text)) {
    return 'ISDCF.DCNC.LATEST';
  }
  if (/Common Metadata Ratings/i.test(text)) {
    return 'MovieLabs.Ratings.LATEST';
  }
  if (/UN/i.test(text)) {
    return 'UN.M49.LATEST';
  }
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
    publisher: "SMPTE",
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
  const refChanges = {};

  for (const doc of results) {
    const index = existingDocs.findIndex(d => d.docId === doc.docId);
    if (index === -1) {
      newDocs.push(doc);
      existingDocs.push(doc);
    } else {
      const existingDoc = existingDocs[index];
      let changed = false;
      const fieldChanges = [];

      for (const key of Object.keys(doc)) {
        const existingVal = existingDoc[key];
        const newVal = doc[key];
        const diff = JSON.stringify(existingVal) !== JSON.stringify(newVal);

        if (diff) {
          existingDoc[key] = newVal;
          fieldChanges.push(key);
          changed = true;

          if ((key === 'references') && newVal) {
            const oldRefs = existingVal || {};
            const addedRefs = {
              normative: newVal.normative.filter(x => !(oldRefs.normative || []).includes(x)),
              bibliographic: newVal.bibliographic.filter(x => !(oldRefs.bibliographic || []).includes(x))
            };
            refChanges[doc.docId] = addedRefs;
          }
        }
      }

      if (changed) {
        updatedDocs.push({ docId: doc.docId, fields: fieldChanges });
      } else {
        skippedDocs.push(doc.docId);
      }
    }
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      _generated: new Date().toISOString(),
      documents: existingDocs
    }, null, 2) + '\n'
  );

  console.log(`✅ Added ${newDocs.length} new documents`);
  console.log(`🔄 Updated ${updatedDocs.length} documents`);
  console.log(`⏭️ Skipped ${skippedDocs.length} unchanged documents`);

  const prLines = [
    `### 🆕 Added ${newDocs.length} document(s):`,
    ...newDocs.map(doc => `- ${doc.docId}`),
    '',
    `### 🔄 Updated ${updatedDocs.length} document(s):`,
    ...updatedDocs.map(d => `- ${d.docId} (fields: ${d.fields.join(', ')})`),
    '',
    `### ⚠️ Skipped ${skippedDocs.length} document(s):`,
    ...skippedDocs.map(id => `- ${id}`),
    ''
  ];

  if (Object.keys(refChanges).length > 0) {
    prLines.push('### 📎 Reference changes:');
    for (const [docId, refs] of Object.entries(refChanges)) {
      const norm = refs.normative.length ? `Normative: ${refs.normative.join(', ')}` : '';
      const bibl = refs.bibliographic.length ? `Bibliographic: ${refs.bibliographic.join(', ')}` : '';
      prLines.push(`- ${docId}${norm || bibl ? ` → ${[norm, bibl].filter(Boolean).join(' | ')}` : ''}`);
    }
  }

  fs.writeFileSync('pr-update-log.txt', prLines.join('\n'));
})();
