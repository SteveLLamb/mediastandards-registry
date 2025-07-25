/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SKIP_VALIDATION_DOMAINS = [
  'https://teams.microsoft.com',
  'https://smpte.sharepoint.com/',
  'https://web.powerapps.com/',
  'https://github.com/orgs/SMPTE/teams/'
];

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
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportFile = `${TARGET_BASE}.validation-report-url-${timestamp}.json`;
const reportPath = path.join(REPORT_PATH, reportFile);

if (!fs.existsSync(FULL_PATH)) {
  console.error(`❌ File not found: ${FULL_PATH}`);
  process.exit(1);
}

console.log(`🔍 Checking URL fields in ${TARGET_FILE}`);

const registry = JSON.parse(fs.readFileSync(FULL_PATH, 'utf8'));
const issues = [];
const errorStats = {};

const isUrlValid = async (url) => {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 400) {
      const resolvedUrl = res.request?.res?.responseUrl || url;
      return {
        ok: true,
        resolvedUrl
      };
    } else {
      return {
        ok: false,
        message: `Unreachable (${res.status})`,
        code: String(res.status)
      };
    }
  } catch (e) {
    const errCode = String(e.response?.status || e.code || e.message);
    return {
      ok: false,
      message: `Unreachable (${errCode})`,
      code: errCode
    };
  }
};

const shouldSkip = (url) => {
  return SKIP_VALIDATION_DOMAINS.some(domain => url.startsWith(domain));
};

const validateEntry = async (entry, key, urlFields) => {
  const problems = [];

  console.log(`🔎 Checking ${key}`);

  for (const field of urlFields) {
    if (!entry[field]) continue;
    const url = entry[field];

    if (shouldSkip(url)) {
      console.log(`⚠️  Skipping validation for ${key} → ${field}: ${url}`);
      continue;
    }

    const result = await isUrlValid(url);

    if (result.ok) {
      if (result.resolvedUrl && result.resolvedUrl !== url) {
        const resolvedField = `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`;
        const expectedResolved = entry[resolvedField];

        if (!expectedResolved || result.resolvedUrl !== expectedResolved) {
          problems.push({
            type: 'redirect',
            field,
            url,
            resolvedUrl: result.resolvedUrl,
            [resolvedField]: expectedResolved || 'undefined',
            message: 'resolved url mismatch'
          });

          console.warn(`❗ ${key} → ${field}: resolved to ${result.resolvedUrl} — expected ${expectedResolved || 'undefined'}`);
        }
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

  for (const entry of registry) {
    if (TARGET_FILE === 'documents.json') {
      await validateEntry(entry, entry.docId, ['href', 'repo']);
    } else if (TARGET_FILE === 'groups.json') {
      await validateEntry(entry, entry.groupId, ['groupLink', 'groupRepo']);
    } else if (TARGET_FILE === 'projects.json') {
      await validateEntry(entry, entry.projectId, ['projectLink']);
    }
  }

  if (issues.length) {
    if (!fs.existsSync(REPORT_PATH)) fs.mkdirSync(REPORT_PATH, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(issues, null, 2));

    for (const entry of issues) {
      for (const problemList of Object.values(entry)) {
        for (const p of problemList) {
          if (p.type === 'unreachable') unreachableCount++;
          else if (p.type === 'redirect') redirectMismatchCount++;
        }
      }
    }

    if (unreachableCount > 0 || redirectMismatchCount > 0) {
      console.log('\n### URL validation issue summary:');
      if (unreachableCount > 0) {
        console.log(`- 🚫 ${unreachableCount} unreachable entr${unreachableCount === 1 ? 'y' : 'ies'}`);
        const summary = Object.entries(errorStats)
          .map(([msg, count]) => `    ${count.toString().padStart(3)} ${msg}`)
          .join('\n');
        console.log('  🔎 Unreachable error breakdown:\n' + summary);
      }
      if (redirectMismatchCount > 0) {
        console.log(`- 🔁 ${redirectMismatchCount} redirect mismatch${redirectMismatchCount === 1 ? '' : 'es'}`);
      }
    }

    console.warn(`⚠️ URL validation report written to ${reportPath}`);
  } else {
    console.log('✅ All URLs resolved successfully — no report generated.');
  }
};

runValidation();
