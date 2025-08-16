const fs = require('fs');
const path = require('path');

function getPrLogPath() {
  // PR/CI mode (pull_request OR manual run flagged as PR)
  if (
    process.env.GITHUB_EVENT_NAME === "pull_request" ||
    process.env.IS_PR_RUN === "true"
  ) {
    if (process.env.PR_LOG_PATH) {
      // If PR_LOG_PATH ends with '.log', treat it as a file path
      if (process.env.PR_LOG_PATH.endsWith('.log')) {
        return process.env.PR_LOG_PATH;
      }
      // Otherwise treat as a directory and append file name
      return path.join(process.env.PR_LOG_PATH, 'pr-log.log');
    }
    // Default: use runner temp dir
    return path.join(process.env.RUNNER_TEMP || '.', 'pr-log.log');
  }

  // Local run → reports folder with timestamp
  const reportsDir = path.resolve(__dirname, '../../logs/extract-runs/');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  return path.join(reportsDir, `pr-log-${ts}.log`);
}

module.exports = { getPrLogPath };