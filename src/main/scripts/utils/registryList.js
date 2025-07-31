const fs = require('fs');
const path = require('path');

const DATA_PATH = "src/main/data/";
const SCHEMA_PATH = "src/main/schemas/";
const VALIDATE_PATH = "src/main/scripts/";

function listRegistries() {
  return fs.readdirSync(SCHEMA_PATH)
    .filter(f => f.endsWith(".schema.json"))
    .map(schemaFile => {
      const name = schemaFile.replace(".schema.json", "");
      return {
        name,
        schemaPath: path.join(SCHEMA_PATH, schemaFile),
        dataPath: path.join(DATA_PATH, `${name}.json`),
        validatePath: path.join(VALIDATE_PATH, `${name}.validate.js`)
      };
    });
}

module.exports = { listRegistries };