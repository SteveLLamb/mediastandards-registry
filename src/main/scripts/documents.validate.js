/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

module.exports = (registry, name) => {
  /* Check for duplicate keys in the registry */
  const keys = [];

  for (let i in registry) {
    if (keys.includes(registry[i].docId)) {
      throw name + " registry key " + registry[i].docId + " is duplicated";
    }
    keys.push(registry[i].docId);
  }

  /* Ensure registry is sorted */
  for (let i = 1; i < registry.length; i++) {
    if ((registry[i - 1].docId).toUpperCase() >= (registry[i].docId).toUpperCase()) {
      throw name + " sort order " + registry[i - 1].docId + " is " +
        ((registry[i - 1].docId === registry[i].docId) ? "duplicated" : "not sorted");
    }
  }

  /* ---- $meta presence check ---- */
  const containerFields = new Set(["status", "references", "workInfo"]);

  function checkMeta(obj, path = "", rootDocId = null) {
    for (const key of Object.keys(obj)) {
      if (key.endsWith("$meta")) continue;

      // Skip container-level $meta checks at top level
      if (containerFields.has(key) && path === "") {
        if (typeof obj[key] === "object") {
          checkMeta(obj[key], `${key}.`, rootDocId);
        }
        continue;
      }

      const metaKey = `${key}$meta`;
      if (!(metaKey in obj)) {
        console.warn(
          `[WARN] Missing $meta for '${path}${key}' in docId '${rootDocId || "(unknown)"}'`
        );
      }

      // Recurse into nested objects
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        checkMeta(obj[key], `${path}${key}.`, rootDocId);
      }
    }
  }

  registry.forEach(doc => checkMeta(doc, "", doc.docId));
};