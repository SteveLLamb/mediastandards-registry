/*
 * Canonicalize and enforce $meta for the documents registry
 */

const fs = require('fs');
const stringify = require('json-stable-stringify');

// Default $meta for manual entries
const defaultMeta = {
  confidence: "medium",
  source: "manual",
  updated: new Date().toISOString()
};

// Container-level fields to skip $meta injection
const containerFields = new Set(["status", "references", "workInfo"]);

function ensureMeta(obj, path = "", rootDocId = null, injectionCounter = { count: 0 }) {
  for (const key of Object.keys(obj)) {
    if (key.endsWith("$meta")) continue;

    // Skip container-level meta injection at top-level
    if (containerFields.has(key) && path === "") {
      if (typeof obj[key] === "object") {
        ensureMeta(obj[key], `${key}.`, rootDocId, injectionCounter);
      }
      continue;
    }

    const metaKey = `${key}$meta`;
    if (!(metaKey in obj)) {
      obj[metaKey] = { ...defaultMeta };
      injectionCounter.count++;
      console.warn(
        `[WARN] Added missing $meta for '${path}${key}' in docId '${rootDocId || "(unknown)"}'`
      );
    }

    // Recurse into nested objects
    if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      ensureMeta(obj[key], `${path}${key}.`, rootDocId, injectionCounter);
    }
  }
}

module.exports = function canonicalizeDocuments(registry, filePath) {
  const injectionCounter = { count: 0 };

  registry.forEach(doc => ensureMeta(doc, "", doc.docId, injectionCounter));

  if (injectionCounter.count > 0) {
    console.log(`🛠 Injected missing $meta for ${injectionCounter.count} fields in documents registry...`);

    // Only append to PR log in PR runs
    if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.IS_PR_RUN === "true") {
      const prLogLines = [
        `\n### 🛠 Canonicalization fixed missing $meta fields in ${changedDocCount} document(s):`
      ];
      for (const [docId, fields] of Object.entries(changedDocs)) {
        prLogLines.push(`- ${docId} (injected: ${fields.join(', ')})`);
      }
      fs.appendFileSync('pr-update-log.txt', prLogLines.join('\n') + '\n');
    }

  }

  fs.writeFileSync(
    filePath,
    stringify(registry, { space: '  ' }) + "\n"
  );
};