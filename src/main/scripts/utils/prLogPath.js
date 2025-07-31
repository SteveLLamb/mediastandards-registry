const fs = require('fs');
const path = require('path');

function getPrLogPath() {
  console.log("📄 [DEBUG:getPrLogPath] GITHUB_EVENT_NAME:", process.env.GITHUB_EVENT_NAME);
  console.log("📄 [DEBUG:getPrLogPath] IS_PR_RUN:", process.env.IS_PR_RUN);
  console.log("📄 [DEBUG:getPrLogPath] PR_LOG_PATH:", process.env.PR_LOG_PATH);
  console.log("📄 [DEBUG:getPrLogPath] RUNNER_TEMP:", process.env.RUNNER_TEMP);

  // CI/PR run → use provided path or fall back to RUNNER_TEMP
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.IS_PR_RUN === "true") {
    if (process.env.PR_LOG_PATH) {
      // If PR_LOG_PATH ends with '.txt', assume it's already a file path
      if (process.env.PR_LOG_PATH.endsWith('.txt')) {
        console.log("📄 [DEBUG:getPrLogPath] Using PR_LOG_PATH as file:", process.env.PR_LOG_PATH);
        return process.env.PR_LOG_PATH;
      }
      const resolved = path.join(process.env.PR_LOG_PATH, 'pr-update-log.txt');
      console.log("📄 [DEBUG:getPrLogPath] PR_LOG_PATH treated as directory →", resolved);
      return resolved;
    }
    const resolved = path.join(process.env.RUNNER_TEMP || '.', 'pr-update-log.txt');
    console.log("📄 [DEBUG:getPrLogPath] No PR_LOG_PATH, defaulting to RUNNER_TEMP →", resolved);
    return resolved;
  }

  // Local run → reports folder with timestamp
  const reportsDir = path.resolve(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  const resolved = path.join(reportsDir, `pr-update-log-${ts}.txt`);
  console.log("📄 [DEBUG:getPrLogPath] Local run, reports path →", resolved);
  return resolved;
}

module.exports = { getPrLogPath };