/*
 * Canonicalize and enforce $meta for the documents registry
 */

const fs = require('fs');
const stringify = require('json-stable-stringify');

// Default $meta for manual entries (timestamp is once per run in UTC)
const defaultMeta = {
  confidence: "medium",
  source: "manual",
  updated: new Date().toISOString()
};

// Container-level fields to skip $meta injection
const containerFields = new Set(["status", "references", "workInfo"]);

function ensureMeta(obj, path = "", rootDocId = null, changedDocs = {}) {
  for (const key of Object.keys(obj)) {
    if (key.endsWith("$meta")) continue;

    // Skip container-level meta injection at top-level
    if (containerFields.has(key) && path === "") {
      if (typeof obj[key] === "object") {
        ensureMeta(obj[key], `${key}.`, rootDocId, changedDocs);
      }
      continue;
    }

    const metaKey = `${key}$meta`;
    if (!(metaKey in obj)) {
      obj[metaKey] = { ...defaultMeta };

      // Track this change for PR log
      if (!changedDocs[rootDocId]) changedDocs[rootDocId] = [];
      changedDocs[rootDocId].push(path + key);

      console.warn(
        `[WARN] Added missing $meta for '${path}${key}' in docId '${rootDocId || "(unknown)"}'`
      );
    }

    // Recurse into nested objects
    if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      ensureMeta(obj[key], `${path}${key}.`, rootDocId, changedDocs);
    }
  }
}

module.exports = function canonicalizeDocuments(registry, filePath) {
  const changedDocs = {};

  registry.forEach(doc => ensureMeta(doc, "", doc.docId, changedDocs));

  const changedDocCount = Object.keys(changedDocs).length;

  if (changedDocCount > 0) {
    console.log(`🛠 Injected missing $meta for ${changedDocCount} document(s) in documents registry...`);

    // Only append to PR log in PR runs
    if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.IS_PR_RUN === "true") {
      const sectionHeader = "### 🛠 Canonicalization fixed missing $meta fields";

      // Read existing PR log (if any)
      let existingLog = "";
      if (fs.existsSync('pr-update-log.txt')) {
        existingLog = fs.readFileSync('pr-update-log.txt', 'utf8');

        // Remove any previous canonicalization section
        const lines = existingLog.split("\n");
        const filtered = [];
        let skipping = false;
        for (const line of lines) {
          if (line.startsWith(sectionHeader)) {
            skipping = true;
          } else if (skipping && line.startsWith("### ")) {
            skipping = false;
            filtered.push(line);
          } else if (!skipping) {
            filtered.push(line);
          }
        }
        existingLog = filtered.join("\n").trim();
      }

      // Build new canonicalization section
      const prLogLines = [
        `\n${sectionHeader} in ${changedDocCount} document(s):`
      ];
      for (const [docId, fields] of Object.entries(changedDocs)) {
        prLogLines.push(`- ${docId} (injected: ${fields.join(', ')})`);
      }

      // Append to the end
      const finalLog = (existingLog ? existingLog + "\n" : "") + prLogLines.join("\n") + "\n";
      fs.writeFileSync('pr-update-log.txt', finalLog);
    }
  }

  fs.writeFileSync(
    filePath,
    stringify(registry, { space: '  ' }) + "\n"
  );
};