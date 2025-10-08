/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const fs = require('fs');
const path = require('path');
const { resolveUrl } = require('./url.resolve.js');
const { checkExpectations } = require('../lib/url.rules.js');


const SKIP_VALIDATION_DOMAINS = [
  'https://teams.microsoft.com',
  'https://smpte.sharepoint.com/',
  'https://web.powerapps.com/',
  'https://github.com/orgs/SMPTE/teams/'
];

const SKIP_PUBLISHERS = [
  // Add exact publisher names here to skip validation for their entries entirely
  // e.g., 'Some Problematic Publisher'
  'SMPTE' //testing
];

const shouldSkipPublisher = (entry) => {
  const pub = (entry && (entry.publisher || entry.publisherName || entry.org || entry.organization)) || '';
  if (!pub) return false;
  return SKIP_PUBLISHERS.some(p => typeof p === 'string' && p.toLowerCase() === String(pub).toLowerCase());
};

const ERROR_METADATA = {
  '404': {
    explanation: 'The URL points to a resource that was not found (dead link).',
    recommendedAction: 'Double-check the URL or remove it if no longer valid.',
    riskLevel: 'High'
  },
  '403': {
    explanation: 'The server refused access to the URL.',
    recommendedAction: 'Check if the resource requires authentication or is private.',
    riskLevel: 'High'
  },
  '503': {
    explanation: 'Service is temporarily unavailable or overloaded.',
    recommendedAction: 'Try again later. Consider flagging for recheck.',
    riskLevel: 'Medium-High'
  },
  'HPE_INVALID_CONSTANT': {
    explanation: 'Malformed response or unexpected protocol from server.',
    recommendedAction: 'Verify the URL manually. It may be non-HTTP content.',
    riskLevel: 'Medium'
  },
  'ENOTFOUND': {
    explanation: 'DNS resolution failed. Host not found.',
    recommendedAction: 'Check for typos or outdated domain.',
    riskLevel: 'High'
  },
  'ECONNABORTED': {
    explanation: 'Connection timed out.',
    recommendedAction: 'Retry later or check the server’s responsiveness.',
    riskLevel: 'Medium-High'
  },
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE': {
    explanation: 'SSL certificate chain is invalid or incomplete.',
    recommendedAction: 'Avoid or investigate SSL issues before trusting the source.',
    riskLevel: 'High'
  },
  'ERR_FR_TOO_MANY_REDIRECTS': {
    explanation: 'The URL is stuck in a redirect loop.',
    recommendedAction: 'Check the server config or redirect chain.',
    riskLevel: 'Medium'
  },
  'ERR_BAD_REQUEST': {
    explanation: 'The server could not understand the request (client error).',
    recommendedAction: 'Validate the URL format or encoding.',
    riskLevel: 'High'
  },
  '400': {
    explanation: 'The server rejected the request as malformed.',
    recommendedAction: 'Inspect for typos or formatting issues.',
    riskLevel: 'High'
  }
};

const TARGET_FILE = process.argv[2] || 'documents.json';
const TARGET_BASE = TARGET_FILE.replace(/\.json$/, '');
const DATA_PATH = 'src/main/data/';
const REPORT_PATH = 'src/main/reports/';
const FULL_PATH = path.join(DATA_PATH, TARGET_FILE);
const REPORT_FILE = 'url_validate_audit.json';
const reportPath = path.join(REPORT_PATH, REPORT_FILE);

if (!fs.existsSync(FULL_PATH)) {
  console.error(`❌ File not found: ${FULL_PATH}`);
  process.exit(1);
}

console.log(`🔍 Checking URL fields in ${TARGET_FILE}`);

const registry = JSON.parse(fs.readFileSync(FULL_PATH, 'utf8'));
const issues = [];
const errorStats = {};

let goodCount = 0;
let skippedByDomain = 0;
let skippedByPublisher = 0;

const expectationStats = {}; // by rule name
let expectationMismatchCount = 0;

const shouldSkip = (url) => {
  return SKIP_VALIDATION_DOMAINS.some(domain => url.startsWith(domain));
};

const validateEntry = async (entry, key, urlFields) => {
  const problems = [];

  for (const field of urlFields) {
    if (!entry[field]) continue;
    const url = entry[field];

    if (shouldSkip(url)) {
      console.log(`⚠️  Skipping validation for ${key} → ${field}: ${url}`);
      skippedByDomain++;
      continue;
    } else {
      console.log(`🔎 Checking ${key} → ${field}: ${url}`);
    }

    const result = await resolveUrl(url);

    if (result.ok) {
      let mismatchFlagged = false;

      // For 'repo' fields, don't enforce a resolved-* comparison; only check reachability.
      if (field !== 'repo' && result.resolvedUrl && result.resolvedUrl !== url) {
        const resolvedField = `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`;
        const expectedResolved = entry[resolvedField];

        if (!expectedResolved || result.resolvedUrl !== expectedResolved) {
          mismatchFlagged = true;
          problems.push({
            type: 'redirect',
            field,
            url,
            resolvedUrl: result.resolvedUrl,
            [resolvedField]: expectedResolved || 'undefined',
            message: 'resolved url mismatch'
          });

          console.warn(`❗ ${key} → ${field}: ${url} → resolved to ${result.resolvedUrl} — expected ${expectedResolved || 'undefined'}`);
        }
      }

      // Run non-destructive expectation checks (prefix/host shape assertions)
      // 1) Check expectations against the original field value (e.g., href)
      try {
        const findingsOrig = checkExpectations({ entry, field, url, docId: entry.docId, publisher: entry.publisher });
        for (const f of findingsOrig) {
          if (!f.ok) {
            expectationMismatchCount++;
            expectationStats[f.rule] = (expectationStats[f.rule] || 0) + 1;
            problems.push({
              type: 'expectation',
              rule: f.rule,
              field: f.field,
              expectedPrefix: f.expectedPrefix,
              actual: f.actual,
              message: `Expected ${f.field} to start with ${f.expectedPrefix}`
            });
          }
        }
      } catch {}

      // 2) If we have a resolved URL, check expectations for the corresponding resolved* field
      if (result.resolvedUrl) {
        const resolvedField = `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`; // e.g., resolvedHref
        try {
          const findingsResolved = checkExpectations({ entry, field: resolvedField, url: result.resolvedUrl, docId: entry.docId, publisher: entry.publisher });
          for (const f of findingsResolved) {
            if (!f.ok) {
              expectationMismatchCount++;
              expectationStats[f.rule] = (expectationStats[f.rule] || 0) + 1;
              problems.push({
                type: 'expectation',
                rule: f.rule,
                field: f.field,
                expectedPrefix: f.expectedPrefix,
                actual: f.actual,
                message: `Expected ${f.field} to start with ${f.expectedPrefix}`
              });
            }
          }
        } catch {}
      }

      if (!mismatchFlagged) {
        // Count as a good (clean) URL when reachable and no mismatch was raised
        goodCount++;
      }

    } else {
      const meta = ERROR_METADATA[result.code] || {
        explanation: 'Unknown error during URL resolution.',
        recommendedAction: 'Manual investigation required.',
        riskLevel: 'Unknown'
      };

      problems.push({
        type: 'unreachable',
        field,
        url,
        message: result.message,
        explanation: meta.explanation,
        recommendedAction: meta.recommendedAction,
        riskLevel: meta.riskLevel
      });

      errorStats[result.message] = (errorStats[result.message] || 0) + 1;

      console.warn(`❌ ${key} → ${field}: ${url} → ${result.message}`);
    }
  }

  if (problems.length) {
    issues.push({ [key]: problems });
  }
};

const runValidation = async () => {
  let unreachableCount = 0;
  let redirectMismatchCount = 0;
  let redirectUndefinedCount = 0;
  let redirectOtherCount = 0;

  for (const entry of registry) {
    if (shouldSkipPublisher(entry)) {
      const key = entry.docId || entry.groupId || entry.projectId || '(unknown-id)';
      console.log(`⚠️  Skipping validation for entry by publisher: ${key} — publisher=${entry.publisher || entry.publisherName || entry.org || entry.organization}`);
      skippedByPublisher++;
      continue;
    }
    if (TARGET_FILE === 'documents.json') {
      await validateEntry(entry, entry.docId, ['href', 'repo']);
    } else if (TARGET_FILE === 'groups.json') {
      await validateEntry(entry, entry.groupId, ['groupLink', 'groupRepo']);
    } else if (TARGET_FILE === 'projects.json') {
      await validateEntry(entry, entry.projectId, ['projectLink']);
    }
  }

  // Tally counts
  for (const entry of issues) {
    for (const problemList of Object.values(entry)) {
      for (const p of problemList) {
        if (p.type === 'unreachable') {
          unreachableCount++;
        } else if (p.type === 'redirect') {
          redirectMismatchCount++;
          if (p.resolvedHref === 'undefined' || p.resolvedHref === undefined) {
            redirectUndefinedCount++;
          } else {
            redirectOtherCount++;
          }
        } else if (p.type === 'expectation') {
          expectationMismatchCount++;
          if (p.rule) expectationStats[p.rule] = (expectationStats[p.rule] || 0) + 1;
        }
      }
    }
  }

  // Build header
  const header = {
    generatedAt: new Date().toISOString(),
    target: TARGET_FILE,
    unreachableCount,
    redirectMismatchCount,
    redirectUndefinedCount,
    redirectOtherCount,
    expectationMismatchCount,
    expectationBreakdown: expectationStats,
    goodCount,
    skippedByDomain,
    skippedByPublisher,
    errorBreakdown: Object.fromEntries(Object.entries(errorStats).sort((a,b)=> a[0]<b[0]? -1 : a[0]>b[0]? 1 : 0))
  };

  // Ensure directory and write a single stable audit file
  if (!fs.existsSync(REPORT_PATH)) fs.mkdirSync(REPORT_PATH, { recursive: true });
  const payload = { ...header, report: issues };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));

  // Console summary mirrors header
  if (unreachableCount > 0 || redirectMismatchCount > 0) {
    console.log('\n### URL validation issue summary:');
    if (unreachableCount > 0) {
      console.log(`- 🚫 ${unreachableCount} unreachable entr${unreachableCount === 1 ? 'y' : 'ies'}`);
      const summary = Object.entries(header.errorBreakdown)
        .map(([msg, count]) => `    ${count.toString().padStart(3)} ${msg}`)
        .join('\n');
      if (summary) console.log('  🔎 Unreachable error breakdown:\n' + summary);
    }
    if (redirectMismatchCount > 0) {
      console.log(`- 🔁 ${redirectMismatchCount} redirect mismatch${redirectMismatchCount === 1 ? '' : 'es'}`);
      if (redirectMismatchCount > 0) {
        console.log(`  ├─ ⚪ ${redirectUndefinedCount} undefined`);
        console.log(`  └─ ⚫ ${redirectOtherCount} other`);
      }
    }
    if (expectationMismatchCount > 0) {
      console.log(`- 📏 ${expectationMismatchCount} expectation mismatch${expectationMismatchCount === 1 ? '' : 'es'}`);
      const expLines = Object.entries(expectationStats)
        .sort((a,b) => b[1]-a[1])
        .map(([rule, count]) => `    ${count.toString().padStart(3)} ${rule}`)
        .join('\n');
      if (expLines) console.log(expLines);
    }
    console.log(`- ✅ ${goodCount} good url${goodCount === 1 ? '' : 's'}`);
    if (skippedByDomain > 0) console.log(`- ⏭️ ${skippedByDomain} skipped by domain`);
    if (skippedByPublisher > 0) console.log(`- ⏭️ ${skippedByPublisher} skipped by publisher`);
    console.warn(`⚠️ URL validation report written to ${reportPath}`);
  } else {
    console.log('✅ All URLs resolved successfully — wrote clean audit header.');
    console.log(`📝 URL validation audit at ${reportPath}`);
  }
};

runValidation();
