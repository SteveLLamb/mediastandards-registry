const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');

const urls = require('../input/urls.json');

const parseRefId = (text) => {
  if (/SMPTE\s+(ST|RP|RDD)\s+(\d+)(-(\d+))?/.test(text)) {
    const [, type, num, , part] = text.match(/SMPTE\s+(ST|RP|RDD)\s+(\d+)(-(\d+))?/);
    return `SMPTE.${type}${part ? `${num}-${part}` : num}.LATEST`;
  }
  if (/IETF\s+RFC\s*(\d+)/i.test(text)) {
    return `IETF.RFC${text.match(/RFC\s*(\d+)/)[1]}.LATEST`;
  }
  if (/ISO\/IEC\s+(\d+(-\d+)*)(:\d+)?/.test(text)) {
    const [, base] = text.match(/ISO\/IEC\s+(\d+(-\d+)*)(:\d+)?/);
    return `ISO.${base}.LATEST`;
  }
  if (/ISO\s+(\d+(-\d+)?)/.test(text)) {
    const [, iso] = text.match(/ISO\s+(\d+(-\d+)?)/);
    return `ISO.${iso}.LATEST`;
  }
  if (/W3C\s+XML Schema/i.test(text)) {
    return 'W3C.XMLSchema-1.LATEST';
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
    $(`#sec-${sectionId} ul li cite`).each((_, el) => {
      const refText = $(el).text();
      const refId = parseRefId(refText);
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

  const fs = require('fs');
  fs.writeFileSync('src/main/output/documents.json', JSON.stringify({
  _generated: new Date().toISOString(),
  documents: results
}, null, 2) + '\n');