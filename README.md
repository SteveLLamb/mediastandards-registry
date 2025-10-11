# Media Standards Registry (MSR)
Automated cross-publisher standards index 
_built and maintained by [Steve LLamb](https://github.com/SteveLLamb)_

[![Extract SMPTE Documents](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/extract-docs.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/extract-docs.yml)
[![Build MasterReference Index](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-reference-index.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-reference-index.yml)
[![Build MasterSuite Index](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-suite-index.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-master-suite-index.yml)
[![Build MSR Site and Test](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-msr-site.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/build-msr-site.yml)
[![Validate Document URLs](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/validate-urls.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/validate-urls.yml)
[![PR Build Preview (MSR site)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/pr-build-preview.yml/badge.svg)](https://github.com/SteveLLamb/mediastandards-registry/actions/workflows/pr-build-preview.yml)

## Why It Exists
The Media Standards Registry (MSR) is a live, automated (and hand curated) registry of media technology documents — extracting, validating, and linking documents across SMPTE, ISO, ITU, AES, and others. 

The MSR began in 2020 as a response to a long-standing gap in how the media and entertainment industry tracks its own standards, best practice, specifications, and other important documents and publications. 

Critical documents from SMPTE, ISO, ITU, AES, and others have always been interconnected — yet their references lived scattered across PDFs, hidden behind paywalls, or trapped in inconsistent formats. MSR was built to solve that: an open, automated registry that maps those relationships, extracts structured metadata, and preserves a living history of the standards ecosystem. 

What started as a personal tool to make sense of tangled reference trees has grown into a self-maintaining system that reveals the lineage, dependencies, and context of the world’s media technology standards.

> See [docs/changelog.md](docs/changelog.md) for details on updates since Q2 2025.

### Live Stats

[![Documents](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmediastandardsregistry.org%2Fapi%2Fstats.json&query=%24.documents.total&label=Documents&color=blue&style=flat&cacheSeconds=3600)](https://mediastandardsregistry.org/api/viewer.html?path=documents.total)
[![Active](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmediastandardsregistry.org%2Fapi%2Fstats.json&query=%24.documents.active&label=Active%20docs&color=brightgreen&style=flat&cacheSeconds=3600)](https://mediastandardsregistry.org/api/viewer.html?path=documents.active)
[![Doc types](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmediastandardsregistry.org%2Fapi%2Fstats.json&query=%24.documents.docTypes&label=Doc%20types&color=informational&style=flat&cacheSeconds=3600)](https://mediastandardsregistry.org/api/viewer.html?path=documents.docTypes)
[![References](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmediastandardsregistry.org%2Fapi%2Fstats.json&query=%24.documents.references&label=References&color=orange&style=flat&cacheSeconds=3600)](https://mediastandardsregistry.org/api/viewer.html?path=documents.references)
[![Publishers](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmediastandardsregistry.org%2Fapi%2Fstats.json&query=%24.documents.publishers&label=Publishers&color=brightgreen&style=flat&cacheSeconds=3600)](https://mediastandardsregistry.org/api/viewer.html?path=documents.publishers)

> _All badges are generated from live JSON at [api/stats.json](https://mediastandardsregistry.org/api/stats.json)._

#### Details
- **Historical range:** 1896 → present  
- **Automation uptime:** 100% since August 2025 (SMPTE)
- **Publishers covered:** SMPTE, NIST, ISO, ITU, AES, and more

### Key Artifacts
- Core data stored as JSON: [`src/main/data`](src/main/data/)
- Schema for data: [`src/main/schemas`](src/main/schemas/)
- Main document Dataset: [`documents.json`](src/main/data/documents.json)
- Document lineages: [Master Suite Index (MSI)](src/main/reports/masterSuiteIndex.json)
- Document reference maps: [Master Reference Index (MRI)](src/main/reports/masterReferenceIndex.json)
- Live API Stats [api/stats.json](https://mediastandardsregistry.org/api/stats.json)
- Public Site generated from `main` at <https://mediastandardsregistry.org>

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
| PR Build Preview| Builds MSR preview prior to publication | PR Creation (Extract/MSI/MRI/Site PRs) | <https://stevellamb.github.io/mediastandards-registry/pr/###/> |

```mermaid
graph LR
  %% Core pipeline
  A[Extract] --- B[MSI] --- C[MRI] --- D[MSR] --- E[URL Validate]

  %% PR preview paths (dotted)
  A -.-> P[PR Build Preview]
  B -.-> P
  C -.-> P
  S[Site/Template PR] -.-> P
```
_Dotted lines indicate PR-triggered preview builds. Extract, MSI, MRI, and site/template PRs all generate a preview._

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