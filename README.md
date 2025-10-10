# Media Standards Registry (MSR)
_Automated cross-publisher standards index built and maintained by [Steve LLamb](https://github.com/SteveLLamb)_

[![Extract SMPTE Documents](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/extract-docs.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/extract-docs.yml)
[![Build MasterReference Index](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-reference-index.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-reference-index.yml)
[![Build MasterSuite Index](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-suite-index.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-suite-index.yml)
[![Build MSR Site and Test](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-msr-site.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-msr-site.yml)
[![Validate Document URLs](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/validate-urls.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/validate-urls.yml)

## Why It Exists
The Media Standards Registry (MSR) is a live, automated (and hand curated) registry of media technology documents — extracting, validating, and linking documents across SMPTE, ISO, ITU, AES, and others. 

The MSR began in 2020 as a response to a long-standing gap in how the media and entertainment industry tracks its own standards, best practice, specifications, and other important documents and publications. 

Critical documents from SMPTE, ISO, ITU, AES, and others have always been interconnected — yet their references lived scattered across PDFs, hidden behind paywalls, or trapped in inconsistent formats. MSR was built to solve that: an open, automated registry that maps those relationships, extracts structured metadata, and preserves a living history of the standards ecosystem. 

What started as a personal tool to make sense of tangled reference trees has grown into a self-maintaining system that reveals the lineage, dependencies, and context of the world’s media technology standards.

### Quick Stats
- **Documents indexed:** ~1,566  
- **Publishers covered:** SMPTE, NIST, ISO, ITU, AES, and more  
- **Historical range:** 1896 → present  
- **Automation uptime:** 100% since August 2025 (SMPTE)

### Key Artifacts
- 📘 Stored as JSON at [`src/main/data`](src/main/data/)
- 📗 Schema for contribution to the list at [`src/main/schemas`](src/main/schemas/)
- [📘 Dataset (`documents.json`)](src/main/data/documents.json)
- [📗 Master Suite Index (MSI)](src/main/reports/masterSuiteIndex.json)
- [📙 Master Reference Index (MRI)](src/main/reports/masterReferenceIndex.json)
- 🌐 Public Site generated from `main` at <https://mediastandardsregistry.org>

## Automation Overview
The Media Standards Registry (MSR) updates itself through a chain of automated GitHub Actions. When appropriate, PRs generate MSR Build Preview review links. 

> See [`docs/samples.md`](docs/samples.md) for full workflow details and live run sample links.

| Stage | Purpose | Trigger | Key Output |
|:------|:---------|:---------|:------------|
| Extract | Pulls and parses SMPTE HTML/PDF metadata | Weekly | `documents.json` |
| MSI | Builds document lineages | PR Merge/Weekly | `masterSuiteIndex.json` |
| MRI | Maps references across all docs | After MSI | `masterReferenceIndex.json` |
| MSR | Builds and publishes the site | After MRI | <https://mediastandardsregistry.org/> |
| URL Validate | Checks and normalizes links | After MSR | `url_validate_audit.json` |
| PR Build | Builds MSR preview | PR Creation | <https://stevellamb.github.io/mediastandards-registry/pr/###/> |

```mermaid
graph LR
  A[Extract] --> B[MSI]
  B --> C[MRI]
  C --> D[MSR]
  D --> E[URL Validate]

  %% PR preview paths (dotted lines indicate PR-triggered previews)
  A -. "PR opened (documents.json)" .-> P[PR Build Preview]
  S[Site/Template change PR] -.-> P
```

_Dotted lines indicate PR-triggered preview builds._
---

### Development
Requires Node 20 + npm.  
Run scripts with:
```bash
npm run extract
npm run build-msi
npm run build-mri
npm run validate-urls
npm run normalize-urls
npm run canonicalize
npm run validate
npm run build
```
---
### Contributing
Issues and pull requests are welcome.  
For questions or collaboration inquiries, contact [Steve LLamb](https://github.com/SteveLLamb).