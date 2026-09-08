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

(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Helper to render abstract text as HTML with newlines as <br><br>
  function renderAbstractHtml(text) {
    if (text == null) return '';
    const normalized = String(text).replace(/\n/g, '\n');
    const escaped = normalized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(/\n/g, '<br><br>');
  }

  // Delegated click handler for abstract expand/collapse (same semantics as suites)
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

  // Delegated click handler for resource description expand/collapse
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.portal-resource-toggle');
    if (!btn) return;

    const container = btn.closest('.portal-resource-descwrap');
    if (!container) return;

    const desc = container.querySelector('.portal-resource-desc');
    const state = container.getAttribute('data-state') || 'short';

    if (state === 'short') {
      if (desc) desc.classList.add('is-expanded');
      container.setAttribute('data-state', 'full');
      btn.textContent = 'Less';
    } else {
      if (desc) desc.classList.remove('is-expanded');
      container.setAttribute('data-state', 'short');
      btn.textContent = 'More';
    }
  });

  function updatePortalNavSeparators() {
    const aOverview = $('portal-nav-overview');
    const aDocs = $('portal-nav-docs');
    const aResources = $('portal-nav-resources');
    const sepOD = $('portal-nav-sep-od');
    const sepDR = $('portal-nav-sep-dr');

    function isVisible(el) {
      if (!el) return false;
      if (el.classList && el.classList.contains('d-none')) return false;
      // Fallback for cases where display is toggled via style
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (cs && cs.display === 'none') return false;
      return true;
    }

    const showOD = isVisible(aOverview) && isVisible(aDocs);
    const showDR = isVisible(aDocs) && isVisible(aResources);

    if (sepOD) sepOD.style.display = showOD ? '' : 'none';
    if (sepDR) sepDR.style.display = showDR ? '' : 'none';
  }

  function pickSlugFromPath() {
    // Expecting /<slug>/ for portal pages.
    // Be robust to local servers that expose /<slug>/index.html
    const parts = String(window.location.pathname || '')
      .split('/')
      .filter(Boolean);

    if (!parts.length) return '';

    const last = parts[parts.length - 1];
    if (last.toLowerCase() === 'index.html' && parts.length >= 2) {
      return decodeURIComponent(parts[parts.length - 2]);
    }

    return decodeURIComponent(last);
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
    return res.json();
  }

  function normalizeStr(x) {
    return String(x == null ? '' : x).trim();
  }

  function normalizePub(p) {
    return normalizeStr(p).toUpperCase();
  }

  function normalizePubList(publisherField) {
    if (publisherField == null) return [];
    if (Array.isArray(publisherField)) {
      return publisherField.map(normalizePub).filter(Boolean);
    }
    return [normalizePub(publisherField)].filter(Boolean);
  }

  function normalizeForSearch(s) {
    // Lowercase and remove all non-alphanumeric so "D-Cinema" matches "DCinema" etc.
    return normalizeStr(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function textIncludes(haystack, needle) {
    const hRaw = normalizeStr(haystack);
    const nRaw = normalizeStr(needle);
    if (!hRaw || !nRaw) return false;

    // First: direct substring on lowercase (keeps behavior for normal keywords)
    const h1 = hRaw.toLowerCase();
    const n1 = nRaw.toLowerCase();
    if (h1.includes(n1)) return true;

    // Fallback: punctuation/whitespace-insensitive match
    const h2 = normalizeForSearch(hRaw);
    const n2 = normalizeForSearch(nRaw);
    if (!h2 || !n2) return false;
    return h2.includes(n2);
  }

  function toSearchString(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return v.map(toSearchString).filter(Boolean).join(' ');
    }
    if (typeof v === 'object') {
      // Shallow join of values (handles simple keyword maps)
      try {
        return Object.values(v).map(toSearchString).filter(Boolean).join(' ');
      } catch (_) {
        return '';
      }
    }
    return String(v);
  }

  function docMatchesKeyword(doc, keyword) {
    const k = normalizeStr(keyword);
    if (!k || !doc) return false;

    // These cover most publishers; some datasets may use different field names.
    const haystacks = [
      doc.docId,
      doc.docLabel,
      doc.docTitle,
      doc.docSuiteTitle,
      doc.abstract,

      // extra breadth
      doc.publisher,
      doc.docType,
      doc.docTypeAbr,
      doc.publicationDate,

      // common optional fields
      doc.searchText,
      doc.keywords,
      doc.subjects,
      doc.tags,
      doc.summary,
      doc.scope
    ].map(toSearchString).filter(Boolean);

    for (const h of haystacks) {
      if (textIncludes(h, k)) return true;
    }
    return false;
  }

  function applyMatchRule(docs, match) {
    const m = match || {};
    const pubs = normalizePubList(m.publisher);
    const suiteTitle = normalizeStr(m.suiteTitle);
    const keyword = normalizeStr(m.keyword);

    return docs.filter(d => {
      if (!d) return false;

      if (pubs.length) {
        const dp = normalizePub(d.publisher);
        if (!dp || !pubs.includes(dp)) return false;
      }

      if (suiteTitle && normalizeStr(d.docSuiteTitle) !== suiteTitle) return false;
      if (keyword && !docMatchesKeyword(d, keyword)) return false;
      return true;
    });
  }

  function isLatestDoc(doc) {
    // Prefer the nested status flag populated by build
    const st = doc && doc.status && typeof doc.status === 'object' ? doc.status : {};
    if (typeof st.latestVersion === 'boolean') return st.latestVersion;
    // Fallback to older annotations if present
    if (typeof doc.isLatestAny === 'boolean') return doc.isLatestAny;
    return false;
  }

  function docStatusText(doc) {
    if (!doc) return '';
    const st = (doc.status && typeof doc.status === 'object') ? doc.status : {};
    return String(doc.currentStatus || (st.latestVersion ? 'Latest' : '') || '').trim();
  }

  function resolvePortalDocs(portal, docsAll) {
    const items = Array.isArray(portal.items) ? portal.items : [];
    const out = [];
    const seen = new Set();

    // DocIds explicitly pinned into the portal via items[{docId}] should NOT be removable by `filter`.
    const pinned = new Set(
      items
        .filter(it => it && typeof it === 'object' && it.docId)
        .map(it => String(it.docId).trim())
        .filter(Boolean)
    );

    const filters = Array.isArray(portal.filter) ? portal.filter : [];

    function resolveToDocIds(rules) {
      const ids = new Set();
      const arr = Array.isArray(rules) ? rules : [];

      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;

        if (it.docId) {
          const want = String(it.docId).trim();
          if (want) ids.add(want);
          continue;
        }

        if (it.match) {
          let hits = applyMatchRule(docsAll, it.match);
          const latestOnly = (it.latestOnly === undefined) ? false : !!it.latestOnly;
          if (latestOnly) hits = hits.filter(isLatestDoc);
          for (const d of hits) {
            if (d && d.docId) ids.add(String(d.docId));
          }
        }
      }

      return ids;
    }

    function addDoc(d) {
      const id = d && d.docId ? String(d.docId) : '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(d);
    }

    for (const it of items) {
      if (!it || typeof it !== 'object') continue;

      if (it.docId) {
        const want = String(it.docId).trim();
        const found = docsAll.find(d => d && String(d.docId) === want);
        if (found) addDoc(found);
        continue;
      }

      if (it.match) {
        let hits = applyMatchRule(docsAll, it.match);
        const latestOnly = (it.latestOnly === undefined) ? false : !!it.latestOnly;
        if (latestOnly) hits = hits.filter(isLatestDoc);
        // stable-ish sort
        hits.sort((a, b) => {
          const ap = normalizeStr(a.publisher);
          const bp = normalizeStr(b.publisher);
          if (ap !== bp) return ap.localeCompare(bp);
          const as = normalizeStr(a.docSuiteTitle);
          const bs = normalizeStr(b.docSuiteTitle);
          if (as !== bs) return as.localeCompare(bs);
          const al = normalizeStr(a.docLabel || a.docId);
          const bl = normalizeStr(b.docLabel || b.docId);
          return al.localeCompare(bl);
        });
        for (const d of hits) addDoc(d);
      }
    }

    // Apply portal-level filters (exclusions) after resolution.
    // `filter` supports the same shapes as `items` but is treated as "remove these".
    if (filters.length) {
      const exclude = resolveToDocIds(filters);
      if (exclude.size) {
        return out.filter(d => {
          if (!d || !d.docId) return false;
          const id = String(d.docId);
          // Pinned docIds always win over filter exclusions.
          if (pinned.has(id)) return true;
          return !exclude.has(id);
        });
      }
    }

    return out;
  }

  function renderSections(portal) {
    const host = $('portal-overview');
    const nav = $('portal-nav-overview');
    if (!host) return;
    const sections = Array.isArray(portal.sections) ? portal.sections : [];
    if (!sections.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      if (nav) nav.style.display = 'none';
      updatePortalNavSeparators();
      return;
    }
    host.style.display = '';
    if (nav) nav.style.display = '';

    let html = '<div class="card">' +
               '<div class="card-header"><h2 class="h5 mb-0">Overview</h2></div>' +
               '<div class="card-body">';

    const rendered = sections
      .map(s => {
        const t = escapeHtml(s && s.title ? s.title : '');
        const b = escapeHtml(s && s.body ? s.body : '');
        if (!t && !b) return null;
        return { t, b };
      })
      .filter(Boolean);

    html += rendered
      .map((s, idx) => {
        const isLast = idx === rendered.length - 1;
        const mb = isLast ? 'mb-0' : 'mb-3';
        return `<div class="${mb}">` +
               (s.t ? `<h3 class="h6 mb-1">${s.t}</h3>` : '') +
               (s.b ? `<p class="mb-0 portal-prewrap">${s.b}</p>` : '') +
               `</div>`;
      })
      .join('');

    html += '</div></div>';
    host.innerHTML = html;
    updatePortalNavSeparators();
  }

  function renderResources(portal) {
    const host = $('portal-resources');
    const nav = $('portal-nav-resources');
    if (!host) return;
    const resources = Array.isArray(portal.resources) ? portal.resources : [];
    if (!resources.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      if (nav) nav.style.display = 'none';
      updatePortalNavSeparators();
      return;
    }
    host.style.display = '';
    if (nav) nav.style.display = '';

    // Group resources by kind (category)
    const groups = new Map();
    for (const r of resources) {
      const kindRaw = (r && r.kind != null) ? String(r.kind).trim() : '';
      const kind = kindRaw || 'Resources';
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(r);
    }

    // Stable, friendly sort for kinds
    const kinds = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    // Sort items within each kind by title then href
    for (const k of kinds) {
      groups.get(k).sort((a, b) => {
        const at = normalizeStr(a && a.title) || normalizeStr(a && a.href);
        const bt = normalizeStr(b && b.title) || normalizeStr(b && b.href);
        if (at !== bt) return at.localeCompare(bt, undefined, { sensitivity: 'base' });
        return normalizeStr(a && a.href).localeCompare(normalizeStr(b && b.href), undefined, { sensitivity: 'base' });
      });
    }

    let html = '<div class="card">' +
               '<div class="card-header"><h2 class="h5 mb-0">Resources</h2></div>' +
               '<div class="card-body">';

    // Grid of independent accordions: each kind controls its own collapse
    html += '<div class="row g-3">';

    kinds.forEach((kind, idx) => {
      const safeKindId = `portalResourcesKind${idx}`;
      const items = groups.get(kind) || [];
      // Normalize header title: first-letter cap + plural
      let kindLabel = kind.trim();
      if (kindLabel) {
        kindLabel = kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);
        if (!kindLabel.endsWith('s')) kindLabel += 's';
      }

      // Default: expanded (independent). If you want collapsed by default later, flip these.
      const isOpen = true;

      html += `
        <div class="col-12 col-lg-4">
          <div class="card portal-resource-card h-100">
            <div class="card-header">
              <h3 class="h6 mb-0 d-flex justify-content-between align-items-center">
                <button class="btn btn-link p-0 text-decoration-none" type="button" data-bs-toggle="collapse" data-bs-target="#${safeKindId}-c" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="${safeKindId}-c">
                  ${escapeHtml(kindLabel)}
                </button>
                <span class="text-muted small">${items.length}</span>
              </h3>
            </div>
            <div id="${safeKindId}-c" class="collapse ${isOpen ? 'show' : ''} portal-resource-collapse">
              <div class="card-body pt-2">
                <ul class="list-group list-group-flush">
      `;

      for (const r of items) {
        const title = escapeHtml(r && r.title ? r.title : '');
        const href = escapeHtml(r && r.href ? r.href : '#');
        const descRaw = normalizeStr(r && r.description);

        // Decide if we should show a toggle: long-ish text or explicit newlines
        const shouldToggle = descRaw && (descRaw.length > 160 || descRaw.includes('\n'));

        html += '<li class="list-group-item">';
        html += '<div class="fw-semibold">' +
                `<a href="${href}" target="_blank" rel="noopener noreferrer">${title || href}</a>` +
                '</div>';

        if (descRaw) {
          const descHtml = renderAbstractHtml(descRaw);
          html += '<div class="portal-resource-descwrap" data-state="short">' +
                  `<div class="portal-resource-desc small text-muted">${descHtml}</div>` +
                  (shouldToggle
                    ? '<button type="button" class="btn btn-link btn-sm p-0 ms-1 portal-resource-toggle">More</button>'
                    : '') +
                  '</div>';
        }

        html += '</li>';
      }

      html += `
                </ul>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    html += '</div></div></div>';
    host.innerHTML = html;
    updatePortalNavSeparators();
  }

  function renderDocs(portal, resolvedDocs) {
    const host = $('portal-docs-table');
    const controls = $('portal-doc-controls');
    const countEl = $('portal-doc-count');
    const searchInput = $('portalDocSearch');
    const publisherSelect = $('portalPublisherFilter');
    const typeSelect = $('portalTypeFilter');
    const sortSelect = $('portalSort');

    if (!host) return;

    const docsBase = (Array.isArray(resolvedDocs) ? resolvedDocs : []).slice();

    if (!docsBase.length) {
      if (controls) controls.classList.add('d-none');
      if (countEl) countEl.textContent = '';
      host.innerHTML = '<h2>Documents</h2><p>No documents matched this portal yet.</p>';
      updatePortalNavSeparators();
      return;
    }

    // Show controls once we have docs
    if (controls) controls.classList.remove('d-none');

    // Populate publisher filter options from docs
    if (publisherSelect) {
      const pubs = Array.from(
        new Set(
          docsBase
            .map(d => normalizeStr(d && d.publisher))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      publisherSelect.innerHTML = '<option value="">All publishers</option>' +
        pubs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    }

    // Populate docType filter options from docs
    if (typeSelect) {
      const types = Array.from(
        new Set(
          docsBase
            .map(d => normalizeStr(d && d.docType))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      typeSelect.innerHTML = '<option value="">All types</option>' +
        types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }

    function docTitleText(d) {
      return String(d && (d.docTitle || d.docSuiteTitle) || '').trim();
    }

    function docLabelText(d) {
      return String(d && (d.docLabel || d.docId) || '').trim();
    }

    function docAbstractText(d) {
      return String(d && (d.abstract || d.summary || d.scope) || '').trim();
    }

    function sortDocs(list, sortSpec) {
      const spec = String(sortSpec || 'label:asc');
      const parts = spec.split(':');
      const k = (parts[0] || 'label').trim();
      const dir = (parts[1] || 'asc').trim().toLowerCase();
      const desc = dir === 'desc';

      function cmp(a, b) {
        if (k === 'title') {
          return docTitleText(a).localeCompare(docTitleText(b), undefined, { sensitivity: 'base' });
        }
        if (k === 'doctype') {
          return normalizeStr(a && a.docType).localeCompare(normalizeStr(b && b.docType), undefined, { sensitivity: 'base' });
        }
        if (k === 'published') {
          // Compare dates as YYYY-MM-DD strings. Empty/unknown dates sort last.
          const ad = normalizeStr(a && a.publicationDate);
          const bd = normalizeStr(b && b.publicationDate);
          if (!ad && !bd) return 0;
          if (!ad) return 1;
          if (!bd) return -1;
          if (ad === bd) return 0;
          return ad.localeCompare(bd);
        }
        if (k === 'publisher') {
          return normalizeStr(a && a.publisher).localeCompare(normalizeStr(b && b.publisher), undefined, { sensitivity: 'base' });
        }
        if (k === 'status') {
          return docStatusText(a).localeCompare(docStatusText(b), undefined, { sensitivity: 'base' });
        }
        // default: label (docLabel fallback docId)
        return docLabelText(a).localeCompare(docLabelText(b), undefined, { numeric: true, sensitivity: 'base' });
      }

      return list.sort((a, b) => {
        const c = cmp(a, b);
        return desc ? -c : c;
      });
    }

    function applyFiltersAndRender() {
      const term = (searchInput && searchInput.value ? searchInput.value : '').trim();
      const pubFilter = (publisherSelect && publisherSelect.value ? publisherSelect.value : '').trim();
      const typeFilter = (typeSelect && typeSelect.value ? typeSelect.value : '').trim();
      const sortKey = (sortSelect && sortSelect.value ? sortSelect.value : 'label:asc');

      const termNorm = term ? normalizeForSearch(term) : '';

      const filtered = docsBase.filter(d => {
        if (!d) return false;

        const pub = normalizeStr(d.publisher);
        if (pubFilter && pub !== pubFilter) return false;

        const dt = normalizeStr(d.docType);
        if (typeFilter && dt !== typeFilter) return false;

        if (termNorm) {
          const hay = [
            docLabelText(d),
            d.docId,
            docTitleText(d),
            d.docSuiteTitle,
            d.publisher,
            docStatusText(d),
            docAbstractText(d)
          ].map(toSearchString).filter(Boolean).join(' ');

          // Use the punctuation/space-insensitive normalization already in use for keywords
          const hayNorm = normalizeForSearch(hay);
          return hayNorm.includes(termNorm);
        }

        return true;
      });

      sortDocs(filtered, sortKey);

      if (countEl) {
        countEl.textContent = `Showing ${filtered.length} / ${docsBase.length} docs`;
      }

      let html = `<h3>Documents</h3>`;
      html += '<div class="card">';
      html += '<div class="table-responsive">';
      html += '<table class="table table-sm mb-0 suite-table">';
      html += '<thead class="table-header"><tr>' +
              '<th>Label</th>' +
              '<th>Document</th>' +
              '<th>Type</th>' +
              '<th>Date</th>' +
              '<th class="status-col">Status</th>' +
              '<th>Publisher</th>' +
              '</tr></thead>';
      html += '<tbody class="table-body">';

      for (const d of filtered) {
        const label = escapeHtml(docLabelText(d) || '');
        const title = escapeHtml(docTitleText(d));
        const pub = escapeHtml(d.publisher || '');

        const st = (d && d.status && typeof d.status === 'object') ? d.status : {};
        const active = st.active === true;
        const withdrawn = st.withdrawn === true;
        const superseded = st.superseded === true;
        const stabilized = st.stabilized === true;

        const stateTokens = [];
        if (active) stateTokens.push('Active');
        if (withdrawn) stateTokens.push('Withdrawn');
        if (superseded) stateTokens.push('Superseded');
        if (stabilized) stateTokens.push('Stabilized');
        const statusText = escapeHtml(stateTokens.join(' · ') || docStatusText(d) || '—');

        const rowClass = (withdrawn || superseded) ? 'suite-row-withdrawn' : '';

        const abstractRaw = docAbstractText(d);

        // Abstract truncation and toggle logic (mirrors suites.js)
        const ABSTRACT_TRUNCATE_CHARS = 280;
        const isLongAbstract =
          abstractRaw && (abstractRaw.length > ABSTRACT_TRUNCATE_CHARS || abstractRaw.includes('\n'));

        let abstractHtmlBlock = '';
        if (abstractRaw) {
          if (!isLongAbstract) {
            const fullHtml = renderAbstractHtml(abstractRaw);
            abstractHtmlBlock = `
              <div class="small text-muted suite-abstract fst-italic">
                ${fullHtml}
              </div>
            `;
          } else {
            // For the short preview, flatten newlines so we don't end up with the More button on a new paragraph.
            const abstractFlat = String(abstractRaw)
              .replace(/\s*\n+\s*/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            const truncatedBase = abstractFlat
              .slice(0, ABSTRACT_TRUNCATE_CHARS)
              .replace(/\s+\S*$/, '')
              .trim();

            const shortHtml = renderAbstractHtml((truncatedBase || abstractFlat) + '…');
            const fullHtml = renderAbstractHtml(abstractRaw);

            abstractHtmlBlock = `
              <div class="small text-muted suite-abstract fst-italic" data-state="short">
                <span class="suite-abstract-short">${shortHtml}</span>
                <span class="suite-abstract-full d-none">${fullHtml}</span>
                <button type="button" class="btn btn-link btn-sm p-0 ms-1 suite-abstract-toggle">More</button>
              </div>
            `;
          }
        }

        const typeText = escapeHtml(d.docType || '—');
        const pubDateText = escapeHtml(d.publicationDate || '—');

        html += `<tr class="${rowClass}">` +
                `<td><a class="text-decoration-none" href="../docs/${encodeURIComponent(String(d.docId))}/">${label}</a></td>` +
                `<td>` +
                  `<div>${title}</div>` +
                  (abstractHtmlBlock ? abstractHtmlBlock : '') +
                `</td>` +
                `<td>${typeText}</td>` +
                `<td class="text-nowrap">${pubDateText}</td>` +
                `<td class="status-col"><span class="status-badge">${statusText}</span></td>` +
                `<td>${pub}</td>` +
                `</tr>`;
      }

      html += '</tbody></table></div></div>';
      host.innerHTML = html;
    }

    // Wire events (idempotent)
    if (searchInput && !searchInput.__msrBound) {
      searchInput.addEventListener('input', applyFiltersAndRender);
      searchInput.__msrBound = true;
    }
    if (publisherSelect && !publisherSelect.__msrBound) {
      publisherSelect.addEventListener('change', applyFiltersAndRender);
      publisherSelect.__msrBound = true;
    }
    if (typeSelect && !typeSelect.__msrBound) {
      typeSelect.addEventListener('change', applyFiltersAndRender);
      typeSelect.__msrBound = true;
    }
    if (sortSelect && !sortSelect.__msrBound) {
      sortSelect.addEventListener('change', applyFiltersAndRender);
      sortSelect.__msrBound = true;
    }

    // Initial render
    applyFiltersAndRender();
    updatePortalNavSeparators();
  }

  async function main() {
    const slug = pickSlugFromPath();
    const titleEl = $('portal-title');
    const summaryEl = $('portal-summary');
    const loadingEl = $('portal-loading');
    const errorEl = $('portal-error');
    const headerEl = $('portal-header');
    const topbarEl = $('portal-topbar');

    try {
      // Portal pages live at /<slug>/, so "../_data" is the site-wide data folder.
      const portalsPayload = await fetchJson('../_data/portals.json');
      const portals = Array.isArray(portalsPayload && portalsPayload.portals) ? portalsPayload.portals : [];
      const portal = portals.find(p => p && String(p.portalSlug) === slug);

      if (!portal) {
        if (loadingEl) loadingEl.classList.add('d-none');
        if (errorEl) errorEl.classList.remove('d-none');
        if (headerEl) headerEl.classList.add('d-none');
        if (topbarEl) topbarEl.classList.add('d-none');
        if (titleEl) titleEl.textContent = 'Portal not found';
        if (summaryEl) summaryEl.textContent = `No portal definition found for "${slug}".`;
        updatePortalNavSeparators();
        return;
      }

      if (titleEl) titleEl.textContent = portal.portalTitle || slug;
      if (summaryEl) summaryEl.textContent = portal.summary || '';
      if (loadingEl) loadingEl.classList.add('d-none');
      if (errorEl) errorEl.classList.add('d-none');
      if (headerEl) headerEl.classList.remove('d-none');
      if (topbarEl) topbarEl.classList.remove('d-none');
      updatePortalNavSeparators();

      renderSections(portal);
      renderResources(portal);

      // Documents registry (single canonical copy for client)
      const docsAll = await fetchJson('../docs/_data/documents.json');
      const docsArr = Array.isArray(docsAll) ? docsAll : (Array.isArray(docsAll && docsAll.documents) ? docsAll.documents : []);
      const resolvedDocs = resolvePortalDocs(portal, docsArr);
      renderDocs(portal, resolvedDocs);

      // set a simple page title
      document.title = `${portal.portalTitle || slug} — ${document.title}`;
    } catch (e) {
      console.error(e);
      if (loadingEl) loadingEl.classList.add('d-none');
      if (errorEl) errorEl.classList.remove('d-none');
      if (headerEl) headerEl.classList.add('d-none');
      if (topbarEl) topbarEl.classList.add('d-none');
      if (titleEl) titleEl.textContent = 'Failed to load portal';
      if (summaryEl) summaryEl.textContent = (e && e.message) ? e.message : String(e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
