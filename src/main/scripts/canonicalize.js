/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

/* Canonicalize the registries */

const fs = require('fs');
const stringify = require('json-stable-stringify');
const { listRegistries } = require('./utils/registryList');
const documentsCanonicalize = require('./documents.canonicalize');

async function run() {
  const regs = {};

  for (const reg of listRegistries()) {
    if (!fs.existsSync(reg.dataPath)) {
      console.warn(`[WARN] No data file found for ${reg.name}, skipping...`);
      continue;
    }
    regs[reg.name] = {
      name: reg.name,
      data: JSON.parse(fs.readFileSync(reg.dataPath, 'utf8')),
      dataFilePath: reg.dataPath
    };
  }

  // Canonicalize each registry
  for (const reg_name in regs) {
    console.log(`🔄 Canonicalizing ${regs[reg_name].name} registry`);

    if (reg_name === "documents") {
      documentsCanonicalize(regs[reg_name].data, regs[reg_name].dataFilePath);
    } else {
      fs.writeFileSync(
        regs[reg_name].dataFilePath,
        stringify(regs[reg_name].data, { space: '  ' }) + "\n"
      );
    }
  }
}

run().catch(err => {
  console.error("Cannot load registries", err);
  process.exit(1);
});