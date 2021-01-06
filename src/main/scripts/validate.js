/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

const fs = require('fs');
const { basename, join } = require('path')
const { readFile, access, readdir } = require('fs').promises;
const ajv = require('ajv');

const DATA_PATH = "src/main/data/";
const DATA_SCHEMA_PATH = "src/main/schemas/%s.schema.json";
const DATA_VALIDATE_PATH = "src/main/scripts/%s.validate.js"; // additional checks

/* load and validate the registry */

var validator_factory = new ajv();

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

    const validate = (registry = data) => {
      /* first check schema */
      if (!schemaValidate(registry))
        throw `${name} registry fails schema validation`

      /* then invoke any additional checks not covered by JSON schema: */
      additionalChecks(registry, name)
    }

    return { ...a, [name]: { schemaVersion, validate, data, name, dataFilePath }}
  }, {})

}

async function validateAll() {
  Object.values(await registries()).map(({ name, validate }) => {
    console.log(`Checking ${name}`)
    validate()
  })
}

module.exports = {
  registries,
  validateAll,
}

// invoke validateAll() if we're run as a script:
if (require.main === module)
  validateAll().catch(console.error)
