// src/main/scripts/url.validate.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

const isUrlValid = async (url) => {
  try {
    const res = await axios.head(url, { timeout: 10000 });
    return res.status >= 200 && res.status < 400;
  } catch (e) {
    return {
      ok: false,
      message: `Unreachable (${e.response?.status || e.code || e.message})`
    };
  }
};

const validateEntry = async (entry, key, urlFields) => {
  const problems = [];

  console.log(`🔎 Checking ${key}`);

  for (const field of urlFields) {
    if (!entry[field]) continue;
    const url = entry[field];
    const result = await isUrlValid(url);

    if (result !== true) {
      problems.push({ field, url, message: result.message });
      console.warn(`❌ ${key} → ${field}: ${url} → ${result.message}`);
    }
  }

  if (problems.length) {
    issues.push({ [key]: problems });
  }
};

const runValidation = async () => {
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
    console.log(`\n### ${issues.length} entr${issues.length === 1 ? 'y has' : 'ies have'} URL issues`);
    console.warn(`⚠️ URL validation report written to ${reportPath}`);
  } else {
    console.log('✅ All URLs resolved successfully — no report generated.');
  }
};

runValidation();
