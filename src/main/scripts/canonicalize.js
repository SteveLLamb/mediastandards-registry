/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

/* Canonicalize the registries */

const fs = require('fs');
const stringify = require('json-stable-stringify');
const documentsCanonicalize = require('./documents.canonicalize');

require('./validate').registries().then(regs => {
  for (const reg_name in regs) {

    console.log(`🔄 Canonicalizing ${regs[reg_name].name}...`);

    if (reg_name === "documents") {
      documentsCanonicalize(regs[reg_name].data, regs[reg_name].dataFilePath);
    } else {
      fs.writeFileSync(
        regs[reg_name].dataFilePath,
        stringify(JSON.parse(fs.readFileSync(regs[reg_name].dataFilePath)), { space: '  ' }) + "\n"
      );
    }
  }
}).catch(err => {
  console.error("Cannot load registries");
  process.exit(1);
});