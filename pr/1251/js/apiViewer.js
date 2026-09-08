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

  var PREFIX = window.msrAssetPrefix || '';
  var PAGE_SIZE = 50;
  var allDocs = [];
  var filtered = [];
  var shown = 0;

  var $search = document.getElementById('api-search-input');
  var $pubFilter = document.getElementById('api-filter-publisher');
  var $typeFilter = document.getElementById('api-filter-doctype');
  var $results = document.getElementById('api-results');
  var $count = document.getElementById('api-result-count');
  var $loading = document.getElementById('api-loading');
  var $loadMore = document.getElementById('api-load-more');
  var $clearAll = document.getElementById('api-clear-all');
  var $docIdInput = document.getElementById('api-docid-input');
  var $docIdFetch = document.getElementById('api-docid-fetch');
  var $jsonOutput = document.getElementById('api-json-output');
  var $jsonCopy = document.getElementById('api-json-copy');
  var $jsonStatus = document.getElementById('api-json-status');

  function show(el) { el && el.classList.remove('d-none'); }
  function hide(el) { el && el.classList.add('d-none'); }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── URL sync ─────────────────────────────────────────────
  function readUrlParams() {
    try {
      var sp = new URLSearchParams(window.location.search);
      var q = sp.get('q');
      var pub = sp.get('publisher');
      var dtype = sp.get('doctype');
      var docid = sp.get('docid');

      if (typeof q === 'string' && q.trim()) $search.value = q.trim();
      if (typeof pub === 'string' && pub.trim()) $pubFilter.value = pub.trim();
      if (typeof dtype === 'string' && dtype.trim()) $typeFilter.value = dtype.trim();
      if (typeof docid === 'string' && docid.trim()) $docIdInput.value = docid.trim();
    } catch (_) {}
  }

  function pushUrlState() {
    try {
      var url = new URL(window.location.href);
      var q = ($search.value || '').trim();
      var pub = $pubFilter.value;
      var dtype = $typeFilter.value;

      if (q) url.searchParams.set('q', q);
      else url.searchParams.delete('q');

      if (pub) url.searchParams.set('publisher', pub);
      else url.searchParams.delete('publisher');

      if (dtype) url.searchParams.set('doctype', dtype);
      else url.searchParams.delete('doctype');

      window.history.replaceState({}, '', url);
    } catch (_) {}
  }

  function hasActiveFilters() {
    return !!($search.value || '').trim() || !!$pubFilter.value || !!$typeFilter.value;
  }

  function syncClearButton() {
    if (hasActiveFilters()) show($clearAll);
    else hide($clearAll);
  }

  // ── Status badges ────────────────────────────────────────
  function statusBadges(status) {
    if (!status || typeof status !== 'object') return '';
    var flags = [];
    if (status.active) flags.push('<span class="badge text-bg-success">ACTIVE</span>');
    if (status.draft) flags.push('<span class="badge text-bg-warning">DRAFT</span>');
    if (status.superseded) flags.push('<span class="badge text-bg-warning">SUPERSEDED</span>');
    if (status.withdrawn) flags.push('<span class="badge text-bg-danger">WITHDRAWN</span>');
    if (status.amended) flags.push('<span class="badge text-bg-secondary">AMENDED</span>');
    if (status.reaffirmed) flags.push('<span class="badge text-bg-info">REAFFIRMED</span>');
    if (status.stabilized) flags.push('<span class="badge text-bg-primary">STABILIZED</span>');
    if (status.versionless) flags.push('<span class="badge bg-success-subtle text-info-emphasis">VERSIONLESS</span>');
    if (status.unknown) flags.push('<span class="badge text-bg-danger">UNKNOWN</span>');
    return flags.join(' ');
  }

  // ── Render one result row ────────────────────────────────
  function renderItem(doc) {
    var label = escapeHtml(doc.docLabel || doc.docId || '');
    var title = escapeHtml(doc.docTitle || '');
    var pub = escapeHtml(doc.publisher || '');
    var type = escapeHtml(doc.docType || '');
    var badges = statusBadges(doc.status);
    var encodedId = encodeURIComponent(doc.docId || '');
    var docId = escapeHtml(doc.docId || '');

    return (
      '<div class="list-group-item list-group-item-action api-result-row py-2 px-3" ' +
           'role="button" data-docid="' + docId + '" style="cursor:pointer;">' +
        '<div class="fw-semibold text-truncate"><code>' + label + '</code></div>' +
        (title ? '<div class="text-muted text-truncate">' + title + '</div>' : '') +
        '<div class="d-flex align-items-center justify-content-between mt-1">' +
          '<div class="text-muted small">' +
            (pub ? '<span class="me-2">' + pub + '</span>' : '') +
            (type ? '<span class="fst-italic">' + type + '</span>' : '') +
          '</div>' +
          '<div class="d-flex align-items-center gap-1">' +
            badges +
          '</div>' +
        '</div>' +
        '<div class="mt-1">' +
          '<a href="' + PREFIX + 'docs/' + encodedId + '/" class="small text-decoration-none" ' +
            'onclick="event.stopPropagation();">' +
            '<i class="bi bi-file-richtext me-1"></i>Open document page &rarr;' +
          '</a>' +
        '</div>' +
      '</div>'
    );
  }

  function renderResults() {
    var end = Math.min(shown + PAGE_SIZE, filtered.length);
    var html = '';
    for (var i = shown; i < end; i++) {
      html += renderItem(filtered[i]);
    }

    if (shown === 0) {
      $results.innerHTML = html || '<div class="text-muted p-3">No results.</div>';
    } else {
      $results.insertAdjacentHTML('beforeend', html);
    }
    shown = end;

    $count.textContent = filtered.length.toLocaleString() + ' result' + (filtered.length !== 1 ? 's' : '');

    if (shown < filtered.length) {
      show($loadMore);
      $loadMore.textContent = 'Load more (' + (filtered.length - shown).toLocaleString() + ' remaining)';
    } else {
      hide($loadMore);
    }
  }

  // ── Filtering ────────────────────────────────────────────
  function applyFilters() {
    var q = ($search.value || '').trim().toLowerCase();
    var pub = $pubFilter.value;
    var dtype = $typeFilter.value;

    var tokens = q ? q.split(/\s+/).filter(Boolean) : [];

    filtered = allDocs.filter(function (d) {
      if (pub && d.publisher !== pub) return false;
      if (dtype && d.docType !== dtype) return false;
      if (!tokens.length) return true;

      var hay = (
        (d.docId || '') + ' ' +
        (d.docLabel || '') + ' ' +
        (d.docTitle || '') + ' ' +
        (d.publisher || '') + ' ' +
        (d.docType || '') + ' ' +
        (Array.isArray(d.keywords) ? d.keywords.join(' ') : '')
      ).toLowerCase();

      for (var i = 0; i < tokens.length; i++) {
        if (hay.indexOf(tokens[i]) === -1) return false;
      }
      return true;
    });

    shown = 0;
    renderResults();
    pushUrlState();
    syncClearButton();
  }

  // ── Clear all ────────────────────────────────────────────
  function clearAll() {
    $search.value = '';
    $pubFilter.value = '';
    $typeFilter.value = '';
    applyFilters();
    $search.focus();
  }

  function populateFilters() {
    var pubs = {};
    var types = {};

    for (var i = 0; i < allDocs.length; i++) {
      var d = allDocs[i];
      if (d.publisher) pubs[d.publisher] = (pubs[d.publisher] || 0) + 1;
      if (d.docType) types[d.docType] = (types[d.docType] || 0) + 1;
    }

    var sortedPubs = Object.keys(pubs).sort(function (a, b) { return a.localeCompare(b); });
    var sortedTypes = Object.keys(types).sort(function (a, b) { return a.localeCompare(b); });

    sortedPubs.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p + ' (' + pubs[p] + ')';
      $pubFilter.appendChild(opt);
    });

    sortedTypes.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t + ' (' + types[t] + ')';
      $typeFilter.appendChild(opt);
    });

    try {
      var sp = new URLSearchParams(window.location.search);
      var pub = sp.get('publisher');
      var dtype = sp.get('doctype');
      if (pub) $pubFilter.value = pub;
      if (dtype) $typeFilter.value = dtype;
    } catch (_) {}
  }

  // ── Stats ────────────────────────────────────────────────
  function loadStats() {
    fetch(PREFIX + 'api/stats.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.documents) {
          setText('api-stat-total', data.documents.total);
          setText('api-stat-active', data.documents.active);
          setText('api-stat-doctypes', data.documents.docTypes);
          setText('api-stat-refs', data.documents.references);
          setText('api-stat-pubs', data.documents.publishers);
        }
        if (data && data.suites) {
          setText('api-stat-suites', data.suites.total);
        }
      })
      .catch(function () {});
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el && val != null) el.textContent = Number(val).toLocaleString();
  }

  // ── Load documents ───────────────────────────────────────
  function loadDocuments() {
    show($loading);
    $count.textContent = 'Loading documents…';

    fetch(PREFIX + 'api/documents.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.json();
      })
      .then(function (payload) {
        allDocs = Array.isArray(payload.documents) ? payload.documents : (Array.isArray(payload) ? payload : []);
        populateFilters();
        applyFilters();
        hide($loading);

        var initDocId = ($docIdInput.value || '').trim();
        if (initDocId) fetchDoc();
      })
      .catch(function (err) {
        hide($loading);
        $count.textContent = 'Failed to load documents: ' + (err.message || err);
      });
  }

  // ── Search input ─────────────────────────────────────────
  var debounceTimer;
  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  }

  $search.addEventListener('input', onSearchInput);
  $pubFilter.addEventListener('change', applyFilters);
  $typeFilter.addEventListener('change', applyFilters);
  $loadMore.addEventListener('click', function () { renderResults(); });
  $clearAll.addEventListener('click', clearAll);

  // ── Single-doc JSON fetch ────────────────────────────────
  function fetchDoc() {
    var id = ($docIdInput.value || '').trim();
    if (!id) {
      $jsonOutput.textContent = 'Please enter a docId.';
      $jsonStatus.textContent = '';
      hide($jsonCopy);
      return;
    }
    var encoded = encodeURIComponent(id);
    var url = PREFIX + 'api/doc/' + encoded + '.json';

    $jsonOutput.textContent = 'Loading…';
    $jsonStatus.innerHTML = 'Fetching ' + escapeHtml(url);
    hide($jsonCopy);

    fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.json();
      })
      .then(function (data) {
        var pretty = JSON.stringify(data, null, 2);
        $jsonOutput.textContent = pretty;
        $jsonStatus.innerHTML =
          '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>' +
          ' &mdash; ' + pretty.length.toLocaleString() + ' chars';
        show($jsonCopy);
      })
      .catch(function (err) {
        $jsonOutput.textContent = 'Error: ' + (err.message || err);
        $jsonStatus.innerHTML = 'Failed to fetch ' + escapeHtml(url);
        hide($jsonCopy);
      });
  }

  $docIdFetch.addEventListener('click', fetchDoc);
  $docIdInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); fetchDoc(); }
  });

  $jsonCopy.addEventListener('click', function () {
    var text = $jsonOutput.textContent || '';
    navigator.clipboard.writeText(text).then(function () {
      $jsonCopy.innerHTML = '<i class="bi bi-check me-1"></i>Copied!';
      setTimeout(function () { $jsonCopy.innerHTML = '<i class="bi bi-clipboard me-1"></i>Copy'; }, 1200);
    });
  });

  // ── Result row click → load JSON ─────────────────────────
  $results.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;

    var row = e.target.closest('.api-result-row');
    if (!row) return;

    var docId = row.getAttribute('data-docid');
    if (!docId) return;

    $docIdInput.value = docId;
    fetchDoc();
    $docIdInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ── Boot ─────────────────────────────────────────────────
  readUrlParams();
  loadStats();
  loadDocuments();
})();
