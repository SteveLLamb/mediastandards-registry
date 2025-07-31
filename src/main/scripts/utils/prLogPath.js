const fs = require('fs');
const path = require('path');

function getPrLogPath() {
  // CI/PR run → use provided path or fall back to RUNNER_TEMP
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.IS_PR_RUN === "true") {
    if (process.env.PR_LOG_PATH) {
      // If PR_LOG_PATH ends with '.txt', assume it's already a file path
      if (process.env.PR_LOG_PATH.endsWith('.txt')) {
        return process.env.PR_LOG_PATH;
      }
      // Otherwise treat it as a directory
      return path.join(process.env.PR_LOG_PATH, 'pr-update-log.txt');
    }
    return path.join(process.env.RUNNER_TEMP || '.', 'pr-update-log.txt');
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