# 📊 Diff Health Check Report
**Comparison:** documents.json vs. documents_premeta.json  
**Date:** 2025‑07‑30  

---

## 1. Summary
| Category | Count | Notes |
|----------|-------|-------|
| **Added** | 1 | `SMPTE.ST429-10.2023-09` |
| **Removed** | 0 | None |
| **Changed** | 79 | Mostly repo trailing‑slash normalization |
| **Unchanged** | (rest) | No change ignoring `$meta` |

---

## 2. Non‑SMPTE Orgs
**All changes are repo URL format only (trailing slash).**  
No other fields changed.

- IMFUG: BP-DS1.2020, BP001.2020, BP002.2020, BP003.2020, BP004.2020  
- ISDCF: D13.2018, DCNC  
- TTML/W3C: ttaf1.dfxp.20181108, ttml.imsc1.1.20181108, ttml.imsc1.2.20200804, ttml1.20181108, ttml2.20181108  

---

## 3. SMPTE Orgs

### 3.1. Repo‑Only Changes
All other SMPTE changes in the diff were **only repo trailing‑slash normalization**.

---

### 3.2. SMPTE – More Than Repo Changes
These match your **intentional test set**:

| Doc ID | Changed Fields |
|--------|----------------|
| SMPTE.ST429-10.2008 | `resolvedHref`, `repo`, `releaseTag`, `status` |
| SMPTE.ST429-2.2023-09 | `references`, `publisher`, `repo` |
| SMPTE.ST429-4.2020 | `doi`, `repo`, `docLabel` |
| SMPTE.ST429-4.2023-05 | `references`, `href` |
| SMPTE.ST430-1.2017Am1.2019 | `repo`, `docLabel` |

---

## 4. Interpretation
- ✅ Non‑SMPTE changes are **harmless** — just formatting of `repo` URLs.
- ✅ SMPTE changes match **expected intentional test cases**.
- ✅ No unexpected large‑scale changes detected.
- ✅ All other fields unaffected.

---

## 5. Next Check Procedure
1. Re‑run this diff after any **bulk update**.
2. Verify that:
   - The **SMPTE “test set”** still shows as changed in expected fields.
   - No new bulk changes appear in **Non‑SMPTE** unless intentional.
3. Investigate if:
   - Any unrelated fields change in bulk.
   - The number of changes spikes unexpectedly.

---

**Status:** ✅ Pass – No unexpected changes detected.