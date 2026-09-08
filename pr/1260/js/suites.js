/*
Copyright (c) 2025-26 PrZ3 LLC (d/b/a [PrZ3](https://github.com/PrZ3r))

Redistribution and use in source and binary forms, with or without modification, 
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

3. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.

4. Neither the name of the copyright holder nor the names of its contributors may
   be used to endorse or promote products derived from this software without specific 
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND 
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR 
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF 
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(async function () {
  function getSuiteSlugFromPath() {
    const path = window.location.pathname || '/';
    const parts = path.replace(/^\/+|\/+$/g, '').split('/');
    const suitesIdx = parts.indexOf('suites');
    // Need a "suites" segment and at least one element after it for the slug
    if (suitesIdx === -1 || suitesIdx === parts.length - 1) return null;
    return decodeURIComponent(parts[suitesIdx + 1]);
  }

  const slug = getSuiteSlugFromPath();
  const loadingEl = document.getElementById('suite-loading');
  const errorEl = document.getElementById('suite-error');
  const headerEl = document.getElementById('suite-header');
  const titleEl = document.getElementById('suite-title');
  const metaEl = document.getElementById('suite-meta');
  const publisherEl = document.getElementById('suite-publisher');
  const noBaseSection = document.getElementById('suite-no-base');
  const noBaseBody = document.getElementById('suite-no-base-body');
  const partsSection = document.getElementById('suite-parts');
  const partsBody = document.getElementById('suite-parts-body');

  // Publisher logo + URL config (shared semantics with docList)
  let publisherLogos = {};
  let publisherLogosDark = {};
  let publisherLogoHeight = 18;
  let publisherLogoAliases = {};
  let publisherUrls = {};
  let publisherUrlAliases = {};

  let publisherLogoAliasLower = {};
  let publisherUrlAliasLower = {};

  async function loadJSONTry(candidates) {
    const errs = [];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
        errs.push(`${url} → ${res.status}`);
      } catch (e) {
        errs.push(`${url} → ${e.message || e}`);
      }
    }
    throw new Error(`Failed to fetch any candidate: ${errs.join(' | ')}`);
  }

  function buildLowerAliasCache(aliasesObj) {
    if (!aliasesObj || typeof aliasesObj !== 'object') return {};
    const m = {};
    for (const [a, c] of Object.entries(aliasesObj)) {
      m[String(a).toLowerCase()] = String(c);
    }
    return m;
  }

  function resolvePublisherLogoFromMap(map, aliasLower, pubRaw) {
    const input = String(pubRaw || '').trim();
    if (!input || !map || typeof map !== 'object') return null;

    // 1) Exact key
    if (map[input]) return map[input];

    // 2) Alias (case-insensitive)
    const canonFromAlias = aliasLower[input.toLowerCase()];
    if (canonFromAlias && map[canonFromAlias]) return map[canonFromAlias];

    // 3) First token before common separators
    const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
    if (firstToken && map[firstToken]) return map[firstToken];

    // 4) Case-insensitive direct match
    const lowerKey = input.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (String(k).toLowerCase() === lowerKey) return v;
    }

    return null;
  }

  function resolvePublisherLogo(pubRaw) {
    return resolvePublisherLogoFromMap(publisherLogos, publisherLogoAliasLower, pubRaw);
  }

  function resolvePublisherLogoDark(pubRaw) {
    if (!publisherLogosDark || !Object.keys(publisherLogosDark).length) return null;
    return resolvePublisherLogoFromMap(publisherLogosDark, publisherLogoAliasLower, pubRaw);
  }

  function resolvePublisherUrl(pubRaw) {
    const input = String(pubRaw || '').trim();
    if (!input) return null;

    // 1) Exact key
    if (publisherUrls[input]) return publisherUrls[input];

    // 2) Alias (case-insensitive)
    const canonFromAlias = publisherUrlAliasLower[input.toLowerCase()];
    if (canonFromAlias && publisherUrls[canonFromAlias]) return publisherUrls[canonFromAlias];

    // 3) First token before common separators
    const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
    if (firstToken && publisherUrls[firstToken]) return publisherUrls[firstToken];

    // 4) Case-insensitive direct match
    const lowerKey = input.toLowerCase();
    for (const [k, v] of Object.entries(publisherUrls)) {
      if (String(k).toLowerCase() === lowerKey) return v;
    }
    return null;
  }

  // Normalize publisher labels for matching collection docs to collection metadata.
  // This handles common variants like "ISO/IEC" vs "ISO" and configured aliases.
  function normalizePublisherForMatch(pubRaw) {
    const input = String(pubRaw || '').trim();
    if (!input) return '';

    const lower = input.toLowerCase();

    // Prefer explicit alias mappings if present.
    const canonFromUrlAlias = publisherUrlAliasLower[lower];
    if (canonFromUrlAlias) return String(canonFromUrlAlias).trim();

    const canonFromLogoAlias = publisherLogoAliasLower[lower];
    if (canonFromLogoAlias) return String(canonFromLogoAlias).trim();

    // Fallback: collapse slash-composite publishers (e.g., ISO/IEC -> ISO).
    if (input.includes('/')) {
      return input.split('/')[0].trim();
    }

    return input;
  }

  // Helper to render abstract text as HTML with newlines as <br><br>
  function renderAbstractHtml(text) {
    if (text == null) return '';
    const normalized = String(text).replace(/\\n/g, '\n');
    const escaped = normalized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(/\n/g, '<br><br>');
  }

  // Delegated click handler for suite abstract expand/collapse
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.suite-abstract-toggle');
    if (!btn) return;

    const container = btn.closest('.suite-abstract');
    if (!container) return;

    const shortSpan = container.querySelector('.suite-abstract-short');
    const fullSpan = container.querySelector('.suite-abstract-full');
    const state = container.getAttribute('data-state') || 'short';

    if (state === 'short') {
      if (shortSpan) shortSpan.classList.add('d-none');
      if (fullSpan) fullSpan.classList.remove('d-none');
      container.setAttribute('data-state', 'full');
      btn.textContent = 'Less';
    } else {
      if (shortSpan) shortSpan.classList.remove('d-none');
      if (fullSpan) fullSpan.classList.add('d-none');
      container.setAttribute('data-state', 'short');
      btn.textContent = 'More';
    }
  });

  if (!slug) {
    if (loadingEl) loadingEl.textContent = 'No suite specified.';
    return;
  }

  try {
    // Load publisher logo + URL configs (same sources used by docList)
    try {
      const cfg = await loadJSONTry(['../../_data/publisher-logos.json']);
      if (cfg && typeof cfg === 'object') {
        publisherLogos = cfg.logos || cfg.publisherLogos || {};
        publisherLogosDark = cfg.logosDark || cfg.publisherLogosDark || {};
        publisherLogoHeight = Number(cfg.height || cfg.publisherLogoHeight) || 18;
        publisherLogoAliases = (cfg.aliases && typeof cfg.aliases === 'object') ? cfg.aliases : {};
        publisherLogoAliasLower = buildLowerAliasCache(publisherLogoAliases);
      }
    } catch (e) {
      console.warn('[suites] publisher logos config not available:', e && e.message ? e.message : e);
    }

    try {
      const ucfg = await loadJSONTry(['../../_data/publisher-urls.json']);
      if (ucfg && typeof ucfg === 'object') {
        publisherUrls = ucfg.urls || {};
        publisherUrlAliases = (ucfg.aliases && typeof ucfg.aliases === 'object') ? ucfg.aliases : {};
        publisherUrlAliasLower = buildLowerAliasCache(publisherUrlAliases);
      }
    } catch (e) {
      console.warn('[suites] publisher urls config not available:', e && e.message ? e.message : e);
    }
    // Load suites index
    const suitesResp = await fetch('../_data/suites.json');
    if (!suitesResp.ok) throw new Error(`HTTP ${suitesResp.status}`);
    const payload = await suitesResp.json();

    const suitesArr = Array.isArray(payload) ? payload : (Array.isArray(payload.suites) ? payload.suites : []);
    const collectionsArr = (!Array.isArray(payload) && Array.isArray(payload.collections)) ? payload.collections : [];

    // Robust slug lookup:
    // - Some builds may store collections under `collections`, others may merge them into `suites`.
    // - Some items may use `suiteSlug` even when kind is collection.
    const allItems = [...suitesArr, ...collectionsArr].filter(Boolean);

    function itemSlug(it) {
      if (!it) return '';
      return String(it.suiteSlug || it.collectionSlug || '').trim();
    }

    const found = allItems.find(it => itemSlug(it) === slug) || null;
    const kind = found
      ? (found.kind || (found.collectionSlug ? 'collection' : 'suite'))
      : null;

    if (!kind) {
      if (loadingEl) loadingEl.classList.add('d-none');
      if (errorEl) errorEl.classList.remove('d-none');
      return;
    }

    const src = found;

    // Normalize suite/collection for compatibility in downstream code
    const suite = (kind === 'suite') ? src : null;
    const collection = (kind === 'collection') ? src : null;

    const pub = (src && src.publisher) ? src.publisher : '';
    const num = (kind === 'suite' && src && src.number) ? src.number : '';
    const suiteTitle = (kind === 'suite')
      ? (src.suiteTitle || '')
      : (src.collectionTitle || src.suiteTitle || '');

    const label = suiteTitle
      ? `${pub}${num ? ` ${num}` : ''} — ${suiteTitle}`
      : `${pub}${num ? ` ${num}` : ''}`;
    
    if (loadingEl) loadingEl.classList.add('d-none');
    if (errorEl) errorEl.classList.add('d-none');

    if (headerEl) headerEl.classList.remove('d-none');
    if (titleEl) titleEl.textContent = label;
    if (publisherEl) {
      const relLight = resolvePublisherLogo(pub);
      const relDark = resolvePublisherLogoDark(pub);
      const linkHref = resolvePublisherUrl(pub);

      // Normalize any relative path to a site-root URL: /resources/...
      // Normalize any relative path so it works in both root deploys and PR preview deploys.
      // Example PR preview base: /pr/678/suites/<slug>/  -> assets live under /pr/678/
      function getDeployPrefix() {
        const p = String(window.location.pathname || '/');
        const idx = p.indexOf('/suites/');
        if (idx > 0) return p.slice(0, idx).replace(/\/+$/g, '');
        return '';
      }

      function toLogoUrl(rel) {
        if (!rel) return null;
        const p = String(rel);
        if (p.startsWith('http://') || p.startsWith('https://')) return p;

        const deployPrefix = getDeployPrefix();

        // If already absolute, prefix PR deploy base when present.
        if (p.startsWith('/')) {
          return deployPrefix ? `${deployPrefix}${p}` : p;
        }

        // Strip leading './' or '/' then prefix with deploy base.
        const trimmed = p.replace(/^\.\//, '').replace(/^\/+/, '');
        return deployPrefix ? `${deployPrefix}/${trimmed}` : `/${trimmed}`;
}

      const lightUrl = toLogoUrl(relLight);
      const darkUrl = toLogoUrl(relDark);

      // Header row is "logo-only" (optionally clickable),
      // since the suite label itself is already in the H1 below.
      if (lightUrl) {
        const attrs = [
          `src="${lightUrl}"`,
          `alt="${pub} logo"`,
          `height="${publisherLogoHeight}"`,
          'class="align-text-bottom me-1 publisher-logo"',
          'loading="lazy"',
          `data-logo-light="${lightUrl}"`
        ];
        if (darkUrl) {
          attrs.push(`data-logo-dark="${darkUrl}"`);
        }
        const imgHtml = `<img ${attrs.join(' ')}>`;
        const content = linkHref
          ? `<a href="${linkHref}" target="_blank" rel="noopener">${imgHtml}</a>`
          : imgHtml;
        publisherEl.innerHTML = content;
      } else if (pub) {
        // No logo found — at most show a small linked publisher name.
        if (linkHref) {
          publisherEl.innerHTML =
            `<a href="${linkHref}" target="_blank" rel="noopener" class="small text-muted">${pub}</a>`;
        } else {
          publisherEl.textContent = '';
        }
      } else {
        publisherEl.textContent = '';
      }
    }
    if (metaEl) {
      const flags = [];
      if (src && src.hasActiveBase) flags.push('has active base');
      if (src && src.hasWithdrawn) flags.push(kind === 'suite' ? 'some parts withdrawn' : 'some docs withdrawn');
      if (src && src.hasStabilized) flags.push('stabilized');

      const parts = (kind === 'suite' && Array.isArray(src.parts)) ? src.parts : [];
      const lineageCount = (src && Array.isArray(src.lineages)) ? src.lineages.length : 0;

      metaEl.textContent = [
        `${pub} ${kind}`,
        kind === 'suite'
          ? (parts.length ? `${parts.length} part${parts.length > 1 ? 's' : ''}` : 'no explicit parts')
          : (lineageCount ? `${lineageCount} doc${lineageCount > 1 ? 's' : ''}` : 'no docs'),
        flags.length ? flags.join(' · ') : null
      ].filter(Boolean).join(' · ');
    }

    // Load effective documents (docList-normalized registry)
    const docsResp = await fetch('../../docs/_data/documents.json');
    if (!docsResp.ok) throw new Error(`HTTP ${docsResp.status}`);
    const docs = await docsResp.json();
    const byId = new Map(docs.map(d => [d.docId, d]));

    function inferPublisherFromDocId(docId) {
      const id = String(docId || '');
      const m = id.match(/^([A-Za-z0-9/+-]+)\./);
      return m ? m[1] : '';
    }

    function getDocPublisher(d) {
      return (d && (d.publisher || d.docPublisher || d.publisherName)) || inferPublisherFromDocId(d && d.docId);
    }

    function getDocSuiteTitle(d) {
      return (d && (d.docSuiteTitle || d.suiteTitle)) ? String(d.docSuiteTitle || d.suiteTitle).trim() : '';
    }

    function docsForCollection(pub, title) {
      const wantPub = normalizePublisherForMatch(pub);
      const wantTitle = String(title || '').trim();
      if (!wantPub || !wantTitle) return [];

      return docs
        .filter(d => {
          if (!d || !d.docId) return false;
          if (normalizePublisherForMatch(getDocPublisher(d)) !== wantPub) return false;
          if (getDocSuiteTitle(d) !== wantTitle) return false;

          const st = d.status || {};
          if (typeof st.latestVersion === 'boolean') return st.latestVersion === true;
          if (typeof st.active === 'boolean') return st.active === true;
          return true;
        })
        .sort((a, b) => {
          const al = (a.docLabel || a.docId || '').toString();
          const bl = (b.docLabel || b.docId || '').toString();
          return al.localeCompare(bl, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    function renderCollectionTable(col) {
      if (!col) return;

      const pub = (col.publisher != null) ? String(col.publisher).trim() : '';
      const title = (col.collectionTitle || col.suiteTitle || '')
        ? String(col.collectionTitle || col.suiteTitle).trim()
        : '';

      const list = docsForCollection(pub, title);

      // Hide the Parts column header for collections
      const partColTh = document.querySelector('th.part-col');
      if (partColTh) partColTh.classList.add('d-none');

      // Collections do not have a base/no-part section
      if (noBaseSection) noBaseSection.classList.add('d-none');
      if (noBaseBody) noBaseBody.innerHTML = '';

      // Reuse the same table UI as suites
      if (partsSection) partsSection.classList.remove('d-none');

      if (partsBody) {
        if (!list.length) {
          partsBody.innerHTML = `
            <tr>
              <td colspan="4" class="text-muted small">No documents found for this collection.</td>
            </tr>
          `;
        } else {
          // Collection = flat list (no parts). Pass null for part column to hide the cell.
          partsBody.innerHTML = list.map(d => docRow(d.docId, null)).join('');
        }
      }
    }

    function docRow(docId, partKey) {
      const d = byId.get(docId);
      const id = docId
      const fallbackLabel = id;
      const docLabel = d && d.docLabel ? d.docLabel : fallbackLabel;
      const docTitle = d && (d.docTitle || d.title) ? (d.docTitle || d.title) : '';
      const abstract = d && d.abstract ? d.abstract : '';
      const href = d && d.href ? d.href : null;
      const status = d && d.status ? d.status : {};
      const active = status.active === true;
      const withdrawn = status.withdrawn === true;
      const superseded = status.superseded === true;
      const stabilized = status.stabilized === true;
      const rowClass = withdrawn ? 'suite-row-withdrawn' : '';
      const stateTokens = [];
      if (active) stateTokens.push('Active');
      if (withdrawn) stateTokens.push('Withdrawn');
      if (superseded) stateTokens.push('Superseded');
      if (stabilized) stateTokens.push('Stabilized');
      const statusText = stateTokens.join(' · ') || '—';
      const pubDate = d && d.publicationDate ? d.publicationDate : '—';

      const labelHtml = `<a href="../../docs/${id}/" class="text-decoration-none">${docLabel}</a>`;

      // Abstract truncation and toggle logic
      const ABSTRACT_TRUNCATE_CHARS = 280;
      const isLongAbstract =
        abstract && (abstract.length > ABSTRACT_TRUNCATE_CHARS || abstract.includes('\n'));
      let abstractHtmlBlock = '';

      if (abstract) {
        if (!isLongAbstract) {
          const fullHtml = renderAbstractHtml(abstract);
          abstractHtmlBlock = `
            <div class="small text-muted suite-abstract fst-italic">
              ${fullHtml}
            </div>
          `;
        } else {
          // For the short preview, flatten newlines so we don't end up with "…" (and the More button)
          // starting after a <br><br> which looks like a weird extra paragraph.
          const abstractFlat = String(abstract)
            .replace(/\s*\n+\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const truncatedBase = abstractFlat
            .slice(0, ABSTRACT_TRUNCATE_CHARS)
            .replace(/\s+\S*$/, '')
            .trim();

          const shortHtml = renderAbstractHtml((truncatedBase || abstractFlat) + '…');
          const fullHtml = renderAbstractHtml(abstract);
          abstractHtmlBlock = `
            <div class="small text-muted suite-abstract fst-italic" data-state="short">
              <span class="suite-abstract-short">${shortHtml}</span>
              <span class="suite-abstract-full d-none">${fullHtml}</span>
              <button type="button" class="btn btn-link btn-sm p-0 ms-1 suite-abstract-toggle">More</button>
            </div>
          `;
        }
      }

      return `
        <tr class="${rowClass}">
          ${partKey !== null ? `<td class="part-col">${partKey || '—'}</td>` : ''}
          <td>
            <div>${labelHtml}</div>
            ${docTitle ? `<div class="small text-muted">${docTitle}</div>` : ''}
            ${abstractHtmlBlock}
          </td>
          <td class="status-col"><span class="status-badge">${statusText}</span></td>
          <td class="pubdate-col">${pubDate}</td>
        </tr>
      `;
    }

    // Collections render as a flat list of latest docs matched by (publisher + docSuiteTitle)
    if (kind === 'collection' && collection) {
      renderCollectionTable(collection);
      return;
    }

    // For suite, ensure the Parts column header is visible
    if (kind === 'suite') {
      const partColTh = document.querySelector('th.part-col');
      if (partColTh) partColTh.classList.remove('d-none');
    }

    // Base (no-part) doc
    if (kind === 'suite' && suite && suite.noPartLatestId) {
      if (noBaseSection) noBaseSection.classList.remove('d-none');
      if (noBaseBody) {
        const d = byId.get(suite.noPartLatestId);
        const id = d.docId
        const title = d && (d.docTitle || d.title) ? (d.docTitle || d.title) : '';
        const label = d && d.docLabel ? d.docLabel : suite.noPartLatestId;
        const link = `<a href="../../docs/${id}/" class="text-decoration-none">${label}</a>`;
        noBaseBody.innerHTML = `
          <p class="mb-1">${link}</p>
          ${title ? `<p class="small text-muted mb-0">${title}</p>` : ''}
        `;
      }
    }

    // Parts table
    const partIds = Array.isArray(suite.allPartsLatestIds) ? suite.allPartsLatestIds : [];
    // Docs table
    if (partsSection && partsBody) {
      partsSection.classList.remove('d-none');

      if (kind === 'suite') {
        const partIds = Array.isArray(suite.allPartsLatestIds) ? suite.allPartsLatestIds : [];
        const latestPerPart = suite.latestPerPart || {};

        const docIdToPart = {};
        Object.entries(latestPerPart).forEach(([partKey, info]) => {
          if (!partKey) return;
          if (info && info.docId) docIdToPart[info.docId] = partKey;
        });

        partsBody.innerHTML = partIds
          .map(id => docRow(id, docIdToPart[id] || ''))
          .join('');
      } else {
        const list = docsForCollection(pub, suiteTitle);
        partsBody.innerHTML = list
          .map(d => docRow(d.docId, '—'))
          .join('');
      }
    }

  } catch (err) {
    console.error('[suites] Failed to render suite', err);
    if (loadingEl) loadingEl.classList.add('d-none');
    if (errorEl) errorEl.classList.remove('d-none');
  }
})();
