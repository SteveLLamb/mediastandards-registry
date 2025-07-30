/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const axios = require('axios');
const { resolveUrlAndInject } = require('./url.resolve.js');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const fs = require('fs');

const urls = require('../input/urls.json');

async function urlExistsNoRedirect(url) {
  try {
    const res = await axios.head(url, { maxRedirects: 0, validateStatus: null });
    return res.status === 200;
  } catch {
    return false;
  }
}

const typeMap = {
        AG: 'Administrative Guideline',
        ST: 'Standard',
        RP: 'Recommended Practice',
        EG: 'Engineering Guideline',
        RDD: 'Registered Disclosure Document',
        OV: 'Overview Document'
      };

const metaConfig = {
  parsed: {
    docNumber: { confidence: 'high', note: 'Parsed from HTML pubNumber meta tag' },
    docPart: { confidence: 'high', note: 'Parsed from HTML pubPart meta tag' },
    docTitle: { confidence: 'high', note: 'Concatenated suite title and publication title' },
    docType: { confidence: 'high', note: 'Publication type parsed from HTML' },
    group: { confidence: 'high', note: 'Working group parsed from HTML pubTC meta tag' },
    publicationDate: { confidence: 'high', note: 'Parsed from HTML pubDateTime meta tag' },
    releaseTag: { confidence: 'high', note: 'Release tag parsed from URL folder structure' },
    publisher: { confidence: 'high', note: 'Static: SMPTE' },
    'status.stage': { confidence: 'high', note: 'Stage parsed from HTML pubStage meta tag' },
    'status.state': { confidence: 'high', note: 'State parsed from HTML pubState meta tag' },
    references: { confidence: 'high', note: 'Parsed from HTML references sections' },
    revisionOf: { confidence: 'high', note: 'Parsed from HTML pubRevisionOf meta tag' },
    default: { confidence: 'high', note: 'Extracted directly from HTML' }
  },

  inferred: {
    docNumber: { confidence: 'medium', note: 'Inferred from root folder name' },
    docPart: { confidence: 'medium', note: 'Inferred from root folder name' },
    docTitle: { confidence: 'low', note: 'Unknown in inferred release' },
    docType: { confidence: 'medium', note: 'Inferred from release folder name' },
    group: { confidence: 'low', note: 'Unknown in inferred release' },
    publicationDate: { confidence: 'medium', note: 'Inferred from release folder name' },
    releaseTag: { confidence: 'high', note: 'Release tag inferred from URL folder structure' },
    publisher: { confidence: 'high', note: 'Static: SMPTE' },
    'status.stage': { confidence: 'medium', note: 'Inferred from release folder name' },
    'status.state': { confidence: 'low', note: 'Unknown in inferred release' },
    references: { confidence: 'low', note: 'Unknown in inferred release' },
    revisionOf: { confidence: 'low', note: 'Unknown in inferred releases' },
    default: { confidence: 'medium', note: '' }
  },

  resolved: {
    docId: { confidence: 'high', note: 'Calculated from parsed/inferred metadata' },
    docLabel: { confidence: 'high', note: 'Constructed from parsed/inferred type/number/date' },
    doi: { confidence: 'medium', note: 'Generated from docId' },
    href: { confidence: 'high', note: 'DOI link generated and verified via redirect resolution' },
    resolvedHref: { confidence: 'high', note: 'Final DOI link resolved via URL redirect verification' },
    repo: { confidence: 'high', note: 'Calculated from parsed or inferred publication type/number/part and verified to exist' },
    'status.active': { confidence: 'high', note: 'Calculated from the releaseTag(s) and other status values' },
    'status.latestVersion': { confidence: 'high', note: 'Calculated from the releaseTag(s)' },
    'status.superseded': { confidence: 'high', note: 'Calculated from the releaseTag(s)' },
    default: { confidence: 'high', note: 'Calculated or verified value' }
  },

  manual: {
    default: { confidence: 'medium', note: 'Manually entered value' }
  },

  unknown: {
    default: { confidence: 'unknown', note: 'Source unknown' }
  }
};

const badRefs = [];

function refsAreDifferent(a, b) {
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  if (aSorted.length !== bSorted.length) return true;
  return aSorted.some((val, idx) => val !== bSorted[idx]);
}

function getMetaDefaults(source, field) {
  const srcMap = metaConfig[source] || metaConfig.unknown;
  return srcMap[field] || srcMap[`status.${field}`] || srcMap.default || metaConfig.unknown.default;
}

function injectMeta(doc, field, source, mode, oldValue) {
  const defaults = getMetaDefaults(source, field);
  const meta = {
    source,
    confidence: defaults.confidence,
    note: defaults.note,
    updated: new Date().toISOString(),
    originalValue: oldValue === undefined ? null : oldValue,
    sourceUrl: doc.__sourceUrl
  };
  if (mode === 'update' && oldValue !== undefined && oldValue !== doc[field]) {
    meta.overridden = true;
  }
  doc[`${field}$meta`] = meta;
}

function injectMetaForDoc(doc, source, mode, changedFieldsMap = {}) {
  const resolvedFields = ['docId', 'docLabel', 'doi', 'href', 'resolvedHref', 'repo'];
  const resolvedStatusFields = ['active', 'latestVersion', 'superseded'];

  for (const field of Object.keys(doc)) {
    if (typeof doc[field] !== 'object' || Array.isArray(doc[field])) {
      const fieldSource = resolvedFields.includes(field) ? 'resolved' : source;
      injectMeta(doc, field, fieldSource, mode, changedFieldsMap[field]);
    }
  }

  if (doc.status && typeof doc.status === 'object') {
    for (const sField of Object.keys(doc.status)) {
      if (typeof doc.status[sField] !== 'object') {
        const fieldSource = resolvedStatusFields.includes(sField) ? 'resolved' : source;
        injectMeta(doc.status, `status.${sField}`, fieldSource, mode, changedFieldsMap[`status.${sField}`]);
      }
    }
  }
}

function inferMetadataFromPath(rootUrl, releaseTag, baseReleases = []) {

  const match = rootUrl.match(/doc\/([^/]+)\/$/);
  const pubTypeNum = match ? match[1].toUpperCase() : null;
  const pubType = pubTypeNum?.match(/^[A-Z]+/)[0];
  const numberPart = pubTypeNum?.replace(pubType, '');
  let docNumber = numberPart;
  let docPart;

  if (numberPart.includes('-')) {
    const [num, part] = numberPart.split('-');
    docNumber = num;
    docPart = part;
  }
  const [datePart] = releaseTag.split('-');
  const pubDate = dayjs(datePart, 'YYYYMMDD');
  const dateString = pubDate.isValid() ? (pubDate.year() < 2023 ? `${pubDate.year()}` : pubDate.format('YYYY-MM')) : 'UNKNOWN';

  let docId = pubTypeNum ? `SMPTE.${pubTypeNum}.${dateString}` : 'UNKNOWN';
  let doi = `10.5594/${docId}`;
  let href = `https://doi.org/${doi}`;
  const repoUrl = `https://github.com/SMPTE/${pubTypeNum.toLowerCase()}/`;

  // Amendments
  if (/^(\d{8})-am(\d+)-/.test(releaseTag)) {
    const [, amendDate, amendNum] = releaseTag.match(/^(\d{8})-am(\d+)-/);
    const amendYear = dayjs(amendDate, 'YYYYMMDD').year();
    const base = baseReleases
      .map(tag => ({ tag, date: dayjs(tag.split('-')[0], 'YYYYMMDD') }))
      .filter(entry => entry.date.isValid() && entry.date.isBefore(dayjs(amendDate, 'YYYYMMDD')))
      .sort((a, b) => b.date - a.date)[0];
    if (base) {
      const baseYear = base.date.year();
      docId = `SMPTE.${pubTypeNum}.${baseYear}Am${amendNum}.${amendYear}`;
      doi = `10.5594/${docId}`;
      href = `https://doi.org/${doi}`;
    }
  }

  return {
    docId,
    releaseTag,
    publicationDate: pubDate.isValid() ? pubDate.format('YYYY-MM-DD') : undefined,
    publisher: 'SMPTE',
    href,
    repo: repoUrl,
    doi,
    docType: typeMap[pubType] || pubType,
    docNumber,
    docPart,
    status: {
      active: false,
      latestVersion: releaseTag === baseReleases[baseReleases.length - 1],
      superseded: releaseTag !== baseReleases[baseReleases.length - 1]
    }
  };
}

function mergeInferredInto(existingDoc, inferredDoc) {
  const safeFields = [
    'docId', 
    'releaseTag', 
    'publicationDate', 
    'publisher', 
    'href',
    'repo',
    'doi', 
    'docType', 
    'docNumber', 
    'docPart'
  ];

  for (const key of safeFields) {
    if (inferredDoc[key] !== undefined) {
      existingDoc[key] = inferredDoc[key];
    }
  }

  // Only update known status fields
  if (!existingDoc.status) existingDoc.status = {};
  const statusFields = ['active', 'latestVersion', 'superseded'];
  for (const field of statusFields) {
    if (inferredDoc.status[field] !== undefined) {
      existingDoc.status[field] = inferredDoc.status[field];
    }
  }

}

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

const extractFromUrl = async (rootUrl) => {
  const res = await axios.get(rootUrl);
  const $ = cheerio.load(res.data);

  const folderLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (/^\d{8}(?:-am\d+)?-(wd|cd|fcd|dp|pub)\/$/i.test(href)) {
      folderLinks.push(href.replace('/', ''));
    }
  });

  if (!folderLinks.length) {
    console.warn(`⚠️ No release folders found at ${rootUrl}`);
    return [];
  }

  folderLinks.sort(); // oldest to newest
  const latestTag = folderLinks[folderLinks.length - 1];

  // Group base versions and amendments for later use
  const baseReleases = folderLinks.filter(tag => !/-am\d+-/.test(tag));

  const docs = [];

  for (const releaseTag of folderLinks) {
    const isLatest = releaseTag === latestTag;

    const sourceUrl = `${rootUrl}${releaseTag}`


    const indexUrl = `${sourceUrl}/index.html`;
    console.log(`🔍 Processing ${sourceUrl}/`);

    try {
      const indexRes = await axios.get(indexUrl);
      const $index = cheerio.load(indexRes.data);

      const pubType = $index('[itemprop="pubType"]').attr('content');
      const pubNumber = $index('[itemprop="pubNumber"]').attr('content');
      const pubPart = $index('[itemprop="pubPart"]').attr('content');
      const pubDate = $index('[itemprop="pubDateTime"]').attr('content');
      const suiteTitle = $index('[itemprop="pubSuiteTitle"]').attr('content');
      const title = $index('title').text().trim();
      const tc = $index('[itemprop="pubTC"]').attr('content');

      const pubDateObj = dayjs(pubDate);
      const dateFormatted = pubDateObj.format('YYYY-MM-DD');
      const dateShort = pubDateObj.format('YYYY-MM');

      const docType = typeMap[pubType?.toUpperCase()] || pubType;
      const label = `SMPTE ${pubType} ${pubNumber}-${pubPart}:${dateShort}`;
      const id = `SMPTE.${pubType}${pubNumber}-${pubPart}.${dateShort}`;
      const doi = `10.5594/SMPTE.${pubType}${pubNumber}-${pubPart}.${pubDateObj.format('YYYY')}`;
      const href = `https://doi.org/${doi}`;
      const pubTypeNum = `${pubType}${pubNumber}${pubPart ? `-${pubPart}` : ''}`;
      const repoUrl = `https://github.com/SMPTE/${pubTypeNum.toLowerCase()}/`;

      const pubStage = $index('[itemprop="pubStage"]').attr('content');
      const pubState = $index('[itemprop="pubState"]').attr('content');

      const refSections = { normative: [], bibliographic: [] };
      ['normative-references', 'bibliography'].forEach((sectionId) => {
        const type = sectionId.includes('normative') ? 'normative' : 'bibliographic';
        $index(`#sec-${sectionId} ul li`).each((_, el) => {
          const cite = $index(el).find('cite');
          const refText = cite.text();
          const href = $index(el).find('a.ext-ref').attr('href') || '';
          const refId = parseRefId(refText, href);
          if (refId) {
            refSections[type].push(refId);
          } else {
            badRefs.push({ docId: id, type, refText, href });
          }
        });
      });

      const revisionRaw = $index('[itemprop="pubRevisionOf"]').attr('content');
      let revisionOf;

      if (revisionRaw) {
        const match = revisionRaw.match(/SMPTE\s+([A-Z]+)\s+(\d+)(?:-(\d+))?:?(\d{4})(?:-(\d{2}))?/);
        if (match) {
          const [, type, number, part, year, month] = match;
          const suffix = (parseInt(year) >= 2023 && month) ? `${year}-${month}` : year;
          const baseId = `SMPTE.${type.toUpperCase()}${part ? `${number}-${part}` : number}.${suffix}`;
          revisionOf = [baseId];
        }
      }

      const doc = {
        docId: id,
        docLabel: label,
        docNumber: pubNumber,
        docPart: pubPart,
        docTitle: `${suiteTitle} ${title}`,
        docType,
        doi,
        group: `smpte-${tc.toLowerCase()}-tc`,
        publicationDate: dateFormatted,
        releaseTag,
        publisher: 'SMPTE',
        href,
        repo: repoUrl,
        status: {
          active: isLatest && pubStage === 'PUB' && pubState === 'pub',
          latestVersion: isLatest,
          stage: pubStage,
          state: pubState,
          superseded: !isLatest
        },
        references: refSections,
        ...(revisionOf && { revisionOf })
      };

      Object.defineProperty(doc, '__sourceUrl', {
        value: `${sourceUrl}/`,
        enumerable: false
      });

      docs.push(doc);

    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 404) {
        console.warn(`⚠️ No index.html found at ${sourceUrl}/`);

        const inferred = inferMetadataFromPath(rootUrl, releaseTag, baseReleases);
        Object.defineProperty(inferred, '__sourceUrl', {
          value: `${sourceUrl}/`,
          enumerable: false
        });
        const existingIndex = docs.findIndex(d => d.docId === inferred.docId);
        if (existingIndex !== -1) {
          mergeInferredInto(docs[existingIndex], inferred);
        } else {
          docs.push(inferred);
        }
        console.warn(`📄 Likely PDF-only release — inferred docId: ${inferred.docId}`);
      } else {
        console.warn(`⚠️ Failed to fetch or parse ${indexUrl}: ${err.message}`);
      }
    }
  }

  return docs;
};

(async () => {
  const results = [];

  for (const url of urls) {
    try {
      const docs = await extractFromUrl(url);  // extractFromUrl now returns an array
      results.push(...docs);                   // flatten and add all versions
    } catch (e) {
      console.error(`❌ Failed to process ${url}:`, e.message);
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
    let hasRefChanges = false;
    let addedRefs = { normative: [], bibliographic: [] };
    let removedRefs = { normative: [], bibliographic: [] };
    let duplicateNormRemoved = false;
    let duplicateBibRemoved = false;

    const index = existingDocs.findIndex(d => d.docId === doc.docId);
    
    if (index === -1) {
      await resolveUrlAndInject(doc, 'href');
      const sourceType = doc.__inferred ? 'inferred' : 'parsed';
       if (doc.repo && !(await urlExistsNoRedirect(doc.repo))) {
        delete doc.repo;
      }
      injectMetaForDoc(doc, sourceType, 'new');
      if (doc.references) {
        injectMeta(doc.references, 'normative', sourceType, 'new', []);
        injectMeta(doc.references, 'bibliographic', sourceType, 'new', []);
      }
      newDocs.push(doc);
      existingDocs.push(doc);
    } else {
      await resolveUrlAndInject(doc, 'href');
      if (doc.repo && !(await urlExistsNoRedirect(doc.repo))) {
        delete doc.repo;
      }
      const existingDoc = existingDocs[index];
      let changedFields = [];
      const oldValues = { ...existingDoc, status: { ...(existingDoc.status || {}) } };
      const newValues = { ...doc, status: { ...(doc.status || {}) } };

      const oldRefs = {
        normative: (existingDoc.references && existingDoc.references.normative) || [],
        bibliographic: (existingDoc.references && existingDoc.references.bibliographic) || []
      };
      const newRefs = {
        normative: (doc.references && doc.references.normative) || [],
        bibliographic: (doc.references && doc.references.bibliographic) || []
      };

      if (doc.references) {
        addedRefs = {
          normative: newRefs.normative.filter(ref => !oldRefs.normative.includes(ref)),
          bibliographic: newRefs.bibliographic.filter(ref => !oldRefs.bibliographic.includes(ref))
        };

        removedRefs = {
          normative: oldRefs.normative.filter(ref => !newRefs.normative.includes(ref)),
          bibliographic: oldRefs.bibliographic.filter(ref => !newRefs.bibliographic.includes(ref))
        };

        if (oldRefs.normative.length > new Set(oldRefs.normative).size) {
          duplicateNormRemoved = true;
        }

        if (oldRefs.bibliographic.length > new Set(oldRefs.bibliographic).size) {
          duplicateBibRemoved = true;
        }

        hasRefChanges =
          addedRefs.normative.length > 0 || addedRefs.bibliographic.length > 0 ||
          removedRefs.normative.length > 0 || removedRefs.bibliographic.length > 0;

        if (hasRefChanges && !changedFields.includes('references')) {
          changedFields.push('references');
        }

        const refsChanged =
          refsAreDifferent(newRefs.normative, oldRefs.normative) ||
          refsAreDifferent(newRefs.bibliographic, oldRefs.bibliographic);

        if (refsChanged) {
          existingDoc.references = newRefs;
          newValues.references = newRefs;

          const fieldSource = doc.__inferred ? 'inferred' : 'parsed';
          injectMeta(existingDoc.references, 'normative', fieldSource, 'update', oldRefs.normative);
          injectMeta(existingDoc.references, 'bibliographic', fieldSource, 'update', oldRefs.bibliographic);
        }
      }

      // Update document fields if there are changes
      for (const key of Object.keys(doc)) {
        const oldVal = oldValues[key];
        const newVal = doc[key];
        const isEqual = typeof newVal === 'object'
          ? JSON.stringify(oldVal) === JSON.stringify(newVal)
          : oldVal === newVal;

        if (!isEqual) {
          if (key === 'references') {
            continue; 
          }

          const resolvedFields = ['docId', 'docLabel', 'doi', 'href', 'resolvedHref', 'repo'];
          const resolvedStatusFields = ['active', 'latestVersion', 'superseded'];

          if (key === 'status') {
            const statusFields = ['active', 'latestVersion', 'superseded', 'stage', 'state'];
            for (const field of statusFields) {
              if (newVal[field] !== undefined && existingDoc.status[field] !== newVal[field]) {
                const oldStatusVal = existingDoc.status[field];
                existingDoc.status[field] = newVal[field];
                const fieldSource = resolvedStatusFields.includes(field) ? 'resolved' : 'parsed';
                // Pass fully qualified name for correct metaConfig lookup
                injectMeta(existingDoc.status, `status.${field}`, fieldSource, 'update', oldStatusVal);
                if (!changedFields.includes('status')) changedFields.push('status');
              }
            }
          } else if (key === 'revisionOf') {
            const oldList = Array.isArray(oldVal) ? oldVal.map(String) : [];
            const newList = Array.isArray(newVal) ? newVal.map(String) : [];

            // Merge and dedupe
            const merged = Array.from(new Set([...oldList, ...newList]));

            if (JSON.stringify(merged) !== JSON.stringify(oldList)) {
              existingDoc[key] = merged;
              newValues[key] = merged;

              const fieldSource = doc.__inferred ? 'inferred' : 'parsed';
              injectMeta(existingDoc, key, fieldSource, 'update', oldList);

              changedFields.push(key);
            }

            newValues[key] = existingDoc[key];

          } else {
            existingDoc[key] = newVal;
            const fieldSource = resolvedFields.includes(key) ? 'resolved' : 'parsed';
            injectMeta(existingDoc, key, fieldSource, 'update', oldVal);
            changedFields.push(key);
          }
        }
      }

      if (changedFields.length > 0) {
        updatedDocs.push({
          docId: doc.docId,
          fields: changedFields,
          addedRefs: {
            normative: [...addedRefs.normative],
            bibliographic: [...addedRefs.bibliographic]
          },
          removedRefs: {
            normative: [...removedRefs.normative],
            bibliographic: [...removedRefs.bibliographic]
          },
          duplicateNormRemoved,
          duplicateBibRemoved,
          oldValues,
          newValues
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
  if (skippedDocs.length > 0) {
    console.log(`⚠️ Skipped ${skippedDocs.length} duplicate document(s):`);
    skippedDocs.forEach(docId => {
      console.log(`- ${docId}`);
    });
  }

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
        const formatVal = (val) =>
          typeof val === 'object' ? JSON.stringify(val, null, 2) : `"${val}"`;

        if (field === 'status') {
          const oldStatus = doc.oldValues.status || {};
          const newStatus = doc.newValues.status || {};
          const statusFields = ['active', 'latestVersion', 'superseded', 'stage', 'state'];

          const diffs = statusFields
            .filter(k => oldStatus[k] !== newStatus[k])
            .map(k => {
              const oldVal = oldStatus[k] === undefined ? `"undefined"` : JSON.stringify(oldStatus[k]);
              const newVal = newStatus[k] === undefined ? `"undefined"` : JSON.stringify(newStatus[k]);
              return `${k}: ${oldVal} → ${newVal}`;
            });

          if (diffs.length > 0) {
            lines.push(`  - status changed: \r\n${diffs.join('\r\n')}`);
          }
        } else if (field === 'revisionOf') {
          const oldStr = JSON.stringify(oldVal || []);
          const newStr = JSON.stringify(newVal || []);
          lines.push(`  - revisionOf changed: ${oldStr} → ${newStr}`);

        } else if (field === 'references') {
          // Skip detailed dump for references — summary will be shown in added/removed refs
        } else {
          lines.push(`  - ${field}:${formatVal(oldVal)} > ${formatVal(newVal)}`);
        }
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

      if (doc.duplicateNormRemoved || doc.duplicateBibRemoved) {
        const types = [];
        if (doc.duplicateNormRemoved) types.push('normative');
        if (doc.duplicateBibRemoved) types.push('bibliographic');
        lines.push(`  - 🔄 Duplicate ${types.join('/')} reference(s) removed`);
      }

      return lines;
    }),
    '',
    `### ⚠️ Skipped ${skippedDocs.length} duplicate(s)`,
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