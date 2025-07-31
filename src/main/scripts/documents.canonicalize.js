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
  }

  fs.writeFileSync(
    filePath,
    stringify(registry, { space: '  ' }) + "\n"
  );
};