/**
 * URL Rules — deterministic canonical URL resolvers
 *
 * Each rule has:
 *  - name: string (identifier for provenance)
 *  - when(ctx): boolean — decide if this rule applies
 *  - resolve(ctx): string|null — return expected canonical URL for the field; null if no opinion
 *
 * ctx shape:
 *  {
 *    entry,          // the document/group/project record
 *    field,          // 'href' | 'repo' | 'groupLink' | 'groupRepo' | 'projectLink' ...
 *    url,            // the original value of entry[field]
 *    docId,          // doc/group/project id string
 *    publisher,      // best-effort publisher string
 *  }
 */

const getPublisher = (e) => (e && (e.publisher || e.publisherName || e.org || e.organization)) || '';

// -- Helpers
const looksLike = (re, s) => !!(s && re.test(String(s)));
const hasHost = (host, url) => {
  try { return new URL(url).hostname.toLowerCase().includes(host.toLowerCase()); } catch { return false; }
};
const ensureHttps = (u) => {
  try {
    const x = new URL(u);
    x.protocol = 'https:';
    return x.toString();
  } catch { return null; }
};
const trimTrailingSlash = (u) => u && u.replace(/\/$/, '');

// --- Simple deterministic rules (low-risk) ---

// WHATWG: normalize to canonical spec root if already a WHATWG link
const ruleWHATWG = {
  name: 'WHATWG',
  when: ({ url, publisher }) => hasHost('whatwg.org', url) || /whatwg/i.test(publisher),
  resolve: ({ url }) => {
    // Keep path but force https + strip fragment/query noise
    try {
      const u = new URL(url);
      u.protocol = 'https:';
      u.hash = '';
      return u.toString();
    } catch { return null; }
  }
};

// IETF/RFC Editor: normalize RFC links to rfc-editor canonical
const ruleIETF = {
  name: 'IETF',
  when: ({ url, publisher }) => hasHost('ietf.org', url) || hasHost('rfc-editor.org', url) || /ietf/i.test(publisher),
  resolve: ({ entry }) => {
    // Try to derive RFC number from docId like IETF.RFC7231 or RFC.7231 or similar
    const docId = String(entry && entry.docId || '');
    const m = docId.match(/RFC[-.]?(\d{3,5})/i);
    if (m) {
      return `https://www.rfc-editor.org/rfc/rfc${m[1]}`;
    }
    return null;
  }
};

// W3C: if it’s a /TR/ shortname, prefer https and no fragment
const ruleW3C = {
  name: 'W3C',
  when: ({ url, publisher }) => hasHost('w3.org', url) || /w3c/i.test(publisher),
  resolve: ({ url }) => {
    try {
      const u = new URL(url);
      u.protocol = 'https:';
      u.hash = '';
      return u.toString();
    } catch { return null; }
  }
};

// NIST: prefer https and drop fragments
const ruleNIST = {
  name: 'NIST',
  when: ({ url, publisher }) => hasHost('nist.gov', url) || /nist/i.test(publisher),
  resolve: ({ url }) => ensureHttps(url)
};

// SMPTE: prefer https and stable content root
const ruleSMPTE = {
  name: 'SMPTE',
  when: ({ url, publisher }) => hasHost('smpte.org', url) || /smpte/i.test(publisher),
  resolve: ({ url }) => ensureHttps(trimTrailingSlash(url))
};

// IEEE: conservative https normalization only (public access varies)
const ruleIEEE = {
  name: 'IEEE',
  when: ({ url, publisher }) => hasHost('ieee.org', url) || /ieee/i.test(publisher),
  resolve: ({ url }) => ensureHttps(url)
};

// Add additional orgs here (ETSI, 3GPP, ISO/IEC webstore, etc.) when patterns are deterministic.

const RULES = [
  ruleWHATWG,
  ruleIETF,
  ruleW3C,
  ruleNIST,
  ruleSMPTE,
  ruleIEEE,
];

function resolveExpected(ctx) {
  for (const r of RULES) {
    try {
      if (r.when(ctx)) {
        const expected = r.resolve(ctx);
        if (expected && typeof expected === 'string') {
          return { field: ctx.field, expected, rule: r.name };
        }
      }
    } catch {/* ignore rule errors */}
  }
  return null;
}

module.exports = { RULES, resolveExpected };
