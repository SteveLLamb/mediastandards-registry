const fs = require('fs');
const path = require('path');
const axios = require('axios');

const INPUT_FILE = process.argv[2] || 'src/main/data/documents.json';
const REPORT_DIR = 'src/main/reports';
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

(async () => {
  let data;
  try {
    const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to load input file "${INPUT_FILE}": ${err.message}`);
    process.exit(1);
  }

  const documents = Array.isArray(data) ? data : data.documents || [];
  const issues = [];

  for (const doc of documents) {
    const docIssues = [];
    console.log(`🔎 Checking ${doc.docId}`);

    for (const field of ['href', 'repo']) {
      const url = doc[field];
      if (url) {
        try {
          await axios.head(url, { timeout: 10000 });
        } catch (e) {
          docIssues.push({
            field,
            url,
            message: `Unreachable (${e.response?.status || e.code || e.message})`
          });
        }
      }
    }

    if (docIssues.length) {
      issues.push({ docId: doc.docId, issues: docIssues });
    }
  }

  if (issues.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(REPORT_DIR, `documents.validation-report-url-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(issues, null, 2));
    console.warn(`⚠️ URL validation report written to ${reportPath}`);
  } else {
    console.log('✅ All URLs resolved successfully. No report written.');
  }
})();