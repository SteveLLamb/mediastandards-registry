/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const axios = require('axios');

async function resolveUrl(url) {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 400) {
      const resolvedUrl = res.request?.res?.responseUrl || url;
      return {
        ok: true,
        resolvedUrl
      };
    } else {
      return {
        ok: false,
        message: `Unreachable (${res.status})`,
        code: String(res.status)
      };
    }
  } catch (e) {
    const errCode = String(e.response?.status || e.code || e.message);
    return {
      ok: false,
      message: `Unreachable (${errCode})`,
      code: errCode
    };
  }
}

module.exports = { resolveUrlAndInject };