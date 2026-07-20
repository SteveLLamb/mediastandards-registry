# FTXML reference apply — backfill onto the 491 ingested docs

> DRY-RUN · 2026-07-20T17:25:52.998Z

## Totals
- FTXML files with refs      : 168
- source docs touched        : **167**
- refs processed             : **2995**
- → canonical refId (direct link) : **40** (40 resolve to a registry doc)
- → orphan slug (MRI, EXTERNAL badge) : **2955**
- unmapped FTXML files       : 0
- docs written               : 0

## By resolution path
| path | refs |
|---|---:|
| `orphan-slug` | 2953 |
| `direct-doi` | 32 |
| `vol+pages` | 6 |
| `mapRefByCite` | 2 |
| `vol+pages-ambiguous` | 2 |

## Notes
- Source docs are mapped through the **content_batch sibling**, not the FTXML `<article-id>`:
  conference FTXML carry an empty article DOI, so an FTXML-DOI match strands all 76 of them.
- `vol+pages` resolves SMPTE self-cites only on **unambiguous** keys; multi-hit keys fall through
  to an orphan mint rather than guessing.
- Orphan slugs are not silent: they render as `<cite>` with an EXTERNAL badge, carry the raw XML +
  citation text in the MRI, and graduate to canonical refIds later via `resolveOrphans` with no
  doc-file edits.
- Targets were greenfield (0 of 491 carried references); existing refs are merged, never replaced.
