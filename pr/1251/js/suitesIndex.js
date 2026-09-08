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
  try {
    // Always from /suites/_data/suites.json relative to site root
    const resp = await fetch('_data/suites.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();

    // Support either:
    //  - legacy: [ ...items ]
    //  - new: { suites: [...], collections: [...] }
    const suitesArr = Array.isArray(payload) ? payload : (Array.isArray(payload.suites) ? payload.suites : []);
    const collectionsArr = (!Array.isArray(payload) && Array.isArray(payload.collections)) ? payload.collections : [];

    // Merge both into one list; user-facing behavior is identical.
    const suites = [
      ...suitesArr.map(s => ({ ...s, _kind: 'suite' })),
      ...collectionsArr.map(c => ({ ...c, _kind: 'collection' }))
    ];

    const container = document.getElementById('suite-list');
    const searchInput = document.getElementById('suiteSearch');
    const publisherSelect = document.getElementById('suitePublisherFilter');
    const kindSelect = document.getElementById('suiteKindFilter');

    if (!container) return;

    // Sort base data: by publisher then number
    suites.sort((a, b) => {
      const ap = a.publisher || '';
      const bp = b.publisher || '';
      if (ap !== bp) return ap.localeCompare(bp);

      const an = a.number || '';
      const bn = b.number || '';
      if (an && bn) {
        const ai = parseInt(an, 10);
        const bi = parseInt(bn, 10);
        if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
        return String(an).localeCompare(String(bn));
      }

      const at = (a.suiteTitle || a.collectionTitle || '').toString();
      const bt = (b.suiteTitle || b.collectionTitle || '').toString();
      return at.localeCompare(bt);
    });

    // Populate publisher filter options from data
    if (publisherSelect) {
      const pubs = Array.from(
        new Set(
          suites
            .map(s => s.publisher || '')
            .filter(p => p && p.trim().length > 0)
        )
      ).sort((a, b) => a.localeCompare(b));

      // Start with "All publishers"
      publisherSelect.innerHTML = '<option value=\"\">All publishers</option>' +
        pubs.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    function renderSuites(list) {
      container.innerHTML = '';
      for (const s of list) {
        const kind = s._kind || (s.collectionSlug ? 'collection' : 'suite');
        const slug = (kind === 'collection') ? (s.collectionSlug || '') : (s.suiteSlug || '');
        const pub = s.publisher || '';
        const num = s.number || '';
        const title = (kind === 'collection')
          ? (s.collectionTitle || s.suiteTitle || '')
          : (s.suiteTitle || '');
        const parts = Array.isArray(s.parts) ? s.parts : [];
        const lineageCount = Array.isArray(s.lineages) ? s.lineages.length : 0;

        const label = title
          ? `${pub}${num ? ` ${num}` : ''} — ${title}`
          : `${pub}${num ? ` ${num}` : ''}`;

        const href = slug ? `${encodeURIComponent(slug)}/` : '#';

        // Add kind badge
        const kindLabel = (kind === 'collection') ? 'Collection' : 'Suite';
        const kindBadge = `<span class="badge bg-info-subtle text-info-emphasis ms-2">${kindLabel}</span>`;

        const el = document.createElement('div');
        el.className = 'col';
        el.innerHTML = `
          <div class="card h-100">
            <div class="card-body">
              <h2 class="h6 card-title mb-1 d-flex align-items-start justify-content-between gap-2">
                <a href="${href}" class="stretched-link text-decoration-none">${label}</a>
                ${kindBadge}
              </h2>
              <div class="text-muted small">
                ${kind === 'suite'
                  ? `Parts: ${parts.length ? parts.join(', ') : '–'}`
                  : `Docs: ${lineageCount || '–'}`}
              </div>
            </div>
          </div>
        `;
        container.appendChild(el);
      }
    }

    function applyFilters() {
      const term = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
      const pubFilter = (publisherSelect && publisherSelect.value ? publisherSelect.value : '').trim();
      const kindFilter = (kindSelect && kindSelect.value ? kindSelect.value : '').trim();

      const filtered = suites.filter(s => {
        const pub = s.publisher || '';
        const num = s.number || '';
        if (pubFilter && pub !== pubFilter) return false;
        if (kindFilter) {
          const kind = s._kind || (s.collectionSlug ? 'collection' : 'suite');
          if (kind !== kindFilter) return false;
        }
        if (term) {
          const title = (s.suiteTitle || s.collectionTitle || '').toString();
          const haystack = `${pub} ${num} ${title}`.toLowerCase();
          return haystack.includes(term);
        }
        return true;
      });

      renderSuites(filtered);
    }

    if (searchInput) {
      searchInput.addEventListener('input', applyFilters);
    }
    if (publisherSelect) {
      publisherSelect.addEventListener('change', applyFilters);
    }
    if (kindSelect) {
      kindSelect.addEventListener('change', applyFilters);
    }

    // Initial render with no filters
    applyFilters();
  } catch (err) {
    console.error('[suitesIndex] Failed to load suites', err);
  }
})();