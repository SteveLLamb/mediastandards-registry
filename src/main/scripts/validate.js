/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const fs = require('fs');
const { basename, join } = require('path')
const { readFile, access, readdir } = require('fs').promises;
const ajv = require('ajv');
const jsonSourceMap = require('json-source-map');

const DATA_PATH = "src/main/data/";
const DATA_SCHEMA_PATH = "src/main/schemas/%s.schema.json";
const DATA_VALIDATE_PATH = "src/main/scripts/%s.validate.js"; // additional checks

/* load and validate the registry */

var validator_factory = new ajv({
  allErrors: true,  // do not bail, optional
  jsonPointers: true,  // totally needed for this
});

async function registries() {
  /* create a mapping of schema/data name to validator */
  return await (await readdir(DATA_PATH)).reduce(async (aProm, dataFile) => {
    const a = await aProm
    const name = basename(dataFile, ".json")
    const schemaFile = DATA_SCHEMA_PATH.replace("%s", name)
    const validateFile = DATA_VALIDATE_PATH.replace("%s", name)
    const schema = JSON.parse(await readFile(schemaFile))
    const schemaVersion = basename(schema.$id)
    const schemaValidate = validator_factory.compile(schema)
    const dataFilePath = join(DATA_PATH, dataFile)
    const data = JSON.parse(await readFile(dataFilePath))
    const valid = validator_factory.validate(schema, data);


    let additionalChecks = () => {}

    /* perform additional checks if applicable */
    try {
      await access(validateFile, fs.constants.F_OK)
      additionalChecks = require("./" + basename(validateFile))
    }
    catch (e) {
      if (e.code !== "ENOENT")
        throw e
    }

    if (!valid) {
      let errorMessage = '';
      const sourceMap = jsonSourceMap.stringify(data, null, 2);
      const jsonLines = sourceMap.json.split('\n');
      validator_factory.errors.forEach(error => {
        errorMessage += '\n\n' + validator_factory.errorsText([ error ]);
        let errorPointer = sourceMap.pointers[error.dataPath];
        errorMessage += '\n> ' + jsonLines.slice(errorPointer.value.line, errorPointer.valueEnd.line).join('\n> ');
      });
      throw new Error(errorMessage);
    }

    /* then invoke any additional checks not covered by JSON schema: */
    console.log(`Running validation for ${name}...`);
    additionalChecks(data, name)

    return { ...a, [name]: { schemaVersion, valid, data, name, dataFilePath }}
  }, {})

}

async function validateAll() {
  const regs = await registries();  
  Object.values(regs).forEach(({ name }) => {
    
  });
}

module.exports = {
  registries,
  validateAll,
}

// invoke validateAll() if we're run as a script:
if (require.main === module)
  validateAll().catch(console.error)
