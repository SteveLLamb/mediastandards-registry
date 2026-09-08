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

/* "Back To Top" button functionality (vanilla JS, no jQuery) */

document.addEventListener('DOMContentLoaded', function () {
  var toTopBtn = document.getElementById('toTopBtn');
  if (toTopBtn) {
    // Show/hide button based on scroll position
    window.addEventListener('scroll', function () {
      if (window.scrollY > 20) {
        toTopBtn.style.display = 'block';
      } else {
        toTopBtn.style.display = 'none';
      }
    });

    // Native smooth scroll
    toTopBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
});

/* Dynamic navbar active state based on current URL vs nav hrefs (vanilla JS) */
document.addEventListener('DOMContentLoaded', function () {
  try {
    var here = window.location && window.location.href ? window.location.href : '';
    if (!here) return;

    // Normalize common index.html endings for comparison
    here = here.replace(/\/index\.html([?#].*)?$/, '/$1');

    var navLinks = document.querySelectorAll('.navbar .nav-link[id^="nav-"]');
    var bestMatch = null;
    var bestLen = 0;

    navLinks.forEach(function (link) {
      if (!link || !link.href) return;
      var href = link.href;

      // Normalize link href similarly
      href = href.replace(/\/index\.html([?#].*)?$/, '/$1');

      // We want the longest href that is a prefix of the current URL
      if (here.indexOf(href) === 0 && href.length > bestLen) {
        bestMatch = link;
        bestLen = href.length;
      }
    });

    // Detect portal pages and force-highlight PORTALS.
    // Reason: HOME href is a prefix of all URLs, and nav-portals uses href="#" (popover trigger),
    // so prefix matching would otherwise always pick HOME.
    var isPortalPage = !!(
      document.getElementById('portal-loading') ||
      document.getElementById('portal-topbar') ||
      document.getElementById('portal-docs-table')
    );

    if (isPortalPage) {
      var portalsLink = document.getElementById('nav-portals');
      if (portalsLink) bestMatch = portalsLink;
    }

    // Final fallback: home
    if (!bestMatch) {
      bestMatch = document.getElementById('nav-home');
    }

    if (bestMatch) {
      bestMatch.classList.add('active');
    }
  } catch (e) {
    if (window && window.console && console.warn) {
      console.warn('[msrbot] Failed to set active nav link:', e);
    }
  }
});

// Theme preference handling (light/dark/auto via localStorage)
(function () {
  var STORAGE_KEY = 'msrTheme';
  var MODE_SYSTEM = 'system';

  function getStoredMode() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      // ignore storage failures
    }
  }

  function getSystemMode() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function describeMode(requested) {
    if (requested === MODE_SYSTEM) {
      return 'Auto';
    }
    if (requested === 'light') {
      return 'Light';
    }
    if (requested === 'dark') {
      return 'Dark';
    }
    return requested;
  }

  function getEffectiveThemeFromDom() {
    var eff = document.documentElement.getAttribute('data-bs-theme');
    return (eff === 'dark') ? 'dark' : 'light';
  }

  function applyThemeToPublisherLogos(effectiveMode) {
    var mode = effectiveMode || getEffectiveThemeFromDom();
    var isDark = (mode === 'dark');
    var imgs = document.querySelectorAll('img.publisher-logo, img[data-logo-light]');

    imgs.forEach(function (img) {
      if (!img) return;
      var light = img.getAttribute('data-logo-light');
      var dark = img.getAttribute('data-logo-dark');
      var target = null;

      if (isDark && dark) {
        target = dark;
      } else if (light) {
        target = light;
      }

      if (target && img.getAttribute('src') !== target) {
        img.setAttribute('src', target);
      }
    });
  }

  // Expose a hook so other scripts (e.g., docList.js) can force a re-sync after rendering
  if (!window.msrApplyThemeToPublisherLogos) {
    window.msrApplyThemeToPublisherLogos = applyThemeToPublisherLogos;
  }

  function installPublisherLogoObserver() {
    if (typeof MutationObserver === 'undefined') return;
    try {
      var observer = new MutationObserver(function (mutations) {
        var hasAdded = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.addedNodes && m.addedNodes.length) {
            hasAdded = true;
            break;
          }
        }
        if (!hasAdded) return;
        // Re-sync any newly added publisher-logo images to the current effective theme
        applyThemeToPublisherLogos();
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          }
        });
      }
    } catch (e) {
      if (window.console && console.warn) {
        console.warn('[msrbot] Failed to install publisher logo observer:', e);
      }
    }
  }

  function updateThemeIndicators(requested) {
    var label = describeMode(requested);

    // Update Preferences link tooltip to reflect current mode
    var prefsTrigger = document.getElementById('user-prefs');
    if (prefsTrigger) {
      prefsTrigger.title = 'Set Preferences';
    }

    // Update the inline label next to Theme in both the hidden template
    // and any currently visible popover content.
    var labelNodes = document.querySelectorAll(
      '#user-prefs-popover-content #theme-current-label, .popover #theme-current-label'
    );
    labelNodes.forEach(function (el) {
      el.textContent = '(Current Selection: ' + label + ')';
    });
  }

  function applyMode(mode) {
    var requested = mode || MODE_SYSTEM;
    var effective = (!mode || mode === MODE_SYSTEM) ? getSystemMode() : mode;
    // Store the logical mode (system/light/dark) for debugging/inspection
    document.documentElement.setAttribute('data-msr-theme', requested);
    document.documentElement.setAttribute('data-bs-theme', effective);

    // Keep UI indicators in sync (tooltip + inline label)
    updateThemeIndicators(requested);

    // Flip publisher logos to match the effective theme
    applyThemeToPublisherLogos(effective);
  }

  function initTheme() {
    var stored = getStoredMode();
    var mode = stored || MODE_SYSTEM;
    applyMode(mode);
  }

  function handleSystemChange() {
    var stored = getStoredMode();
    // Only react to system changes when user preference is Auto (system)
    if (!stored || stored === MODE_SYSTEM) {
      applyMode(MODE_SYSTEM);
    }
  }

  // Watch for OS-level dark/light changes when matchMedia is available
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) {
      mq.addEventListener('change', handleSystemChange);
    } else if (mq.addListener) {
      mq.addListener(handleSystemChange);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    installPublisherLogoObserver();
  });

  // Delegate clicks from Preferences popover buttons/links
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bs-theme-choice]');
    if (!btn) return;

    e.preventDefault();
    var mode = btn.getAttribute('data-bs-theme-choice') || MODE_SYSTEM;
    storeMode(mode);
    applyMode(mode);

    // Hide the preferences popover if it is open
    if (window.bootstrap && bootstrap.Popover) {
      var trigger = document.getElementById('user-prefs');
      if (trigger) {
        var inst = bootstrap.Popover.getInstance(trigger);
        if (inst) inst.hide();
      }
    }
  });
})();

// Portals: load portal-cards.json and render into Home + Navbar (vanilla JS)
(function () {
  function getAssetPrefix() {
    try {
      return (window && window.msrAssetPrefix) ? String(window.msrAssetPrefix) : '';
    } catch (e) {
      return '';
    }
  }

  function safeText(x) {
    return String(x == null ? '' : x);
  }

  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fetchPortalCards() {
    var prefix = getAssetPrefix();
    var url = prefix + '_data/portal-cards.json';
    return fetch(url)
      .then(function (r) {
        if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '')); 
        return r.json();
      })
      .then(function (data) {
        var arr = (data && Array.isArray(data.portals)) ? data.portals : [];
        return arr;
      });
  }

  function resolvePortalHref(p) {
    var prefix = getAssetPrefix();

    // Prefer slug when present (most stable across environments)
    var slug = p && p.portalSlug ? String(p.portalSlug).trim() : '';
    if (slug) {
      // IMPORTANT: keep this RELATIVE (no leading '/') so it works under subpath deployments (e.g., /MSRBot.io/)
      var rel = slug.replace(/^\/+/, '').replace(/\/+$/, '') + '/';
      return prefix ? prefix + rel : rel;
    }

    var raw = p && p.portalUrl ? String(p.portalUrl).trim() : '';
    if (!raw) return '#';

    // If absolute URL, strip to pathname so preview/local don't jump to prod
    if (/^https?:\/\//i.test(raw)) {
      try {
        var u = new URL(raw);
        raw = (u && u.pathname) ? u.pathname : '/';
      } catch (e) {
        // ignore parse failures; fall through
      }
    }

    // If root-relative, convert to relative and apply assetPrefix
    if (raw.charAt(0) === '/') {
      raw = raw.replace(/^\/+/, '');
      return prefix ? prefix + raw : raw;
    }

    // Otherwise treat as already-relative
    return raw;
  }

  function renderNavPortalsPopover(portals) {
    // Render into the hidden template (used to construct the popover)
    var tplHost = document.getElementById('nav-portals-list');

    // Also update any currently visible popover instance
    var liveHosts = document.querySelectorAll('.popover #nav-portals-list');

    function setHtmlInto(el, html) {
      if (!el) return;
      el.innerHTML = html;
    }

    if (!tplHost && (!liveHosts || !liveHosts.length)) return;

    if (!portals || !portals.length) {
      var emptyHtml = '<div class="text-muted small">No portals yet.</div>';
      setHtmlInto(tplHost, emptyHtml);
      liveHosts.forEach(function (h) { setHtmlInto(h, emptyHtml); });
      return;
    }

    var html = '<div class="list-group list-group-flush">';

    portals.forEach(function (p) {
      if (!p) return;
      var title = escapeHtml(p.portalTitle || p.portalSlug || 'Portal');
      var url = resolvePortalHref(p);
      var summary = escapeHtml(p.summary || '');

      html += '<a class="list-group-item list-group-item-action" href="' + escapeHtml(url || '#') + '">';
      html += '  <div class="fw-semibold">' + title + '</div>';
      if (summary) {
        html += '  <div class="text-muted small">' + summary + '</div>';
      }
      html += '</a>';
    });

    html += '</div>';

    setHtmlInto(tplHost, html);
    liveHosts.forEach(function (h) { setHtmlInto(h, html); });
  }

  function renderHomeCards(portals) {
    var host = document.getElementById('portal-cards-home');
    var emptyEl = document.getElementById('portal-cards-home-empty');
    if (!host) return;

    if (!portals || !portals.length) {
      host.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('d-none');
      return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');

    var html = '';

    portals.forEach(function (p) {
      if (!p) return;
      var title = escapeHtml(p.portalTitle || p.portalSlug || 'Portal');
      var url = resolvePortalHref(p);
      var summary = escapeHtml(p.summary || '');
      var resourcesCount = (typeof p.resourcesCount === 'number') ? p.resourcesCount : null;

      html += '<a class="list-group-item list-group-item-action px-3 py-3" href="' + escapeHtml(url || '#') + '">';
      html += '  <div class="d-flex justify-content-between align-items-start gap-2">';
      html += '    <h3 class="h6 mb-1">' + title + '</h3>';
      if (resourcesCount != null) {
        html += '    <span class="badge text-bg-secondary ms-2 flex-shrink-0">Resources: ' + String(resourcesCount) + '</span>';
      }
      html += '  </div>';
      if (summary) {
        html += '  <p class="text-muted small mb-0">' + summary + '</p>';
      }
      html += '</a>';
    });

    host.innerHTML = html;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Only do work if portals UI exists on the page
    var hasNav = !!document.getElementById('nav-portals');
    var hasHome = !!document.getElementById('portal-cards-home');
    if (!hasNav && !hasHome) return;

    fetchPortalCards()
      .then(function (portals) {
        // Stable alphabetical order by title
        portals.sort(function (a, b) {
          var at = safeText(a && a.portalTitle || a && a.portalSlug).toLowerCase();
          var bt = safeText(b && b.portalTitle || b && b.portalSlug).toLowerCase();
          return at.localeCompare(bt);
        });

        renderNavPortalsPopover(portals);
        renderHomeCards(portals);
      })
      .catch(function (e) {
        // Fail quietly; portals are optional UI sugar
        if (window && window.console && console.warn) {
          console.warn('[msrbot] Could not load portal-cards:', e);
        }

        var tplHost = document.getElementById('nav-portals-list');
        var liveHosts = document.querySelectorAll('.popover #nav-portals-list');
        var msg = '<div class="text-muted small">Portals unavailable.</div>';
        if (tplHost) tplHost.innerHTML = msg;
        liveHosts.forEach(function (h) { h.innerHTML = msg; });

        var emptyEl = document.getElementById('portal-cards-home-empty');
        var host = document.getElementById('portal-cards-home');
        if (host) host.innerHTML = '';
        if (emptyEl) {
          emptyEl.textContent = 'Portals unavailable.';
          emptyEl.classList.remove('d-none');
        }
      });
  });
})();
