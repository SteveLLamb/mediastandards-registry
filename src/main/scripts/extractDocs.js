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

  const refSections = {
    normative: [],
    bibliographic: []
  };

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

const deepEqualUnordered = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every(item => b.includes(item));
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
    try {
      const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
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
      let changed = false;

      for (const key of Object.keys(doc)) {
        const newVal = doc[key];
        const existingVal = existingDoc[key];

        if (key === 'references') {
          const n1 = newVal?.normative || [];
          const n2 = existingVal?.normative || [];
          const b1 = newVal?.bibliographic || [];
          const b2 = existingVal?.bibliographic || [];

          if (!deepEqualUnordered(n1, n2) || !deepEqualUnordered(b1, b2)) {
            existingDoc.references = { normative: [...n1], bibliographic: [...b1] };
            changed = true;
          }
        } else if (
          typeof newVal === 'object'
            ? JSON.stringify(existingVal) !== JSON.stringify(newVal)
            : existingVal !== newVal
        ) {
          existingDoc[key] = newVal;
          changed = true;
        }
      }

      if (changed) {
        updatedDocs.push(doc.docId);
      } else {
        skippedDocs.push(doc.docId);
      }
    }
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        _generated: new Date().toISOString(),
        documents: existingDocs
      },
      null,
      2
    ) + '\n'
  );

  console.log(`✅ Added ${newDocs.length} new document(s)`);
  console.log(`🔄 Updated ${updatedDocs.length}`);
  if (skippedDocs.length > 0) {
    console.log(`⚠️ Skipped ${skippedDocs.length} (unchanged):`);
    skippedDocs.forEach(id => console.log(`  - ${id}`));
  }

  const prLines = [
    `### 🆕 Added ${newDocs.length} new document(s):`,
    ...newDocs.map(doc => `- ${doc.docId}`),
    '',
    `### 🔄 Updated ${updatedDocs.length} existing document(s):`,
    ...updatedDocs.map(id => `- ${id}`),
    '',
    `### ⚠️ Skipped ${skippedDocs.length} (unchanged):`,
    ...skippedDocs.map(id => `- ${id}`),
    ''
  ];

  fs.writeFileSync('pr-update-log.txt', prLines.join('\n'));
})();
