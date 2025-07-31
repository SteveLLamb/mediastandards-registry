const fs = require('fs');
const path = require('path');

function getPrLogPath() {
  // CI/PR run → always go to ephemeral location
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.IS_PR_RUN === "true") {
    return path.join(process.env.PR_LOG_PATH || process.env.RUNNER_TEMP || '.', 'pr-update-log.txt');
  }

  // Local run → reports folder with timestamp
  const reportsDir = path.resolve(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  return path.join(reportsDir, `pr-update-log-${ts}.txt`);
}

module.exports = { getPrLogPath };