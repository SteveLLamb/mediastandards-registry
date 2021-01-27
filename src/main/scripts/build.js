/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

/* pass the option --nopdf to disable PDF creation */

const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const hb = require('handlebars');
const puppeteer = require('puppeteer');
const ajv = require('ajv');

const REGISTRIES_REPO_PATH = "src/main";
const SITE_PATH = "src/site";
const BUILD_PATH = "build";

/* list the available registries type (lower case), id (single, for links), titles (Upper Case), and schema builds */

const registries = [
  {
    "listType": "documents",
    "templateType": "documents",
    "idType": "document",
    "listTitle": "Documents"
  }
]

/* load and build the templates */

async function buildRegistry ({ listType, templateType, idType, listTitle }) {
  console.log(`Building ${templateType} started`)

  var DATA_PATH = path.join(REGISTRIES_REPO_PATH, "data/" + listType + ".json");
  var DATA_SCHEMA_PATH = path.join(REGISTRIES_REPO_PATH, "schemas/" + listType + ".schema.json");
  var TEMPLATE_PATH = "src/main/templates/" + templateType + ".hbs";
  var PAGE_SITE_PATH = templateType + ".html";
  var PDF_SITE_PATH = templateType + ".pdf";

  /* load header and footer for templates */

  hb.registerPartial('header', await fs.readFile("src/main/templates/partials/header.hbs", 'utf8'));
  hb.registerPartial('footer', await fs.readFile("src/main/templates/partials/footer.hbs", 'utf8'));

  /* instantiate template */
  
  let template = hb.compile(
    await fs.readFile(
      TEMPLATE_PATH,
      'utf8'
    )
  );
  
  if (!template) {
    throw "Cannot load HTML template";
  }

  /* if Conditional helpers */

  hb.registerHelper('ifeq', function (a, b, options) {
    if (a == b) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });

  hb.registerHelper('ifactive', function (a, b, options) {
      return a + '-' + b
  });

  hb.registerHelper('ifnoteq', function (a, b, options) {
    if (a !== b) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });

  hb.registerHelper('ifinc', function (a, b, options) {
    if (a.includes(b)) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });
  
  /* load and validate the registry */

  let registry = JSON.parse(
    await fs.readFile(DATA_PATH)
  );
  
  if (!registry) {
    throw "Cannot load registry";
  }
  
  console.log(`${listTitle} schema validation started`)

  var validator_factory = new ajv();

  let validator = validator_factory.compile(
    JSON.parse(await fs.readFile(DATA_SCHEMA_PATH))
  );
  
  if (! validator(registry)) {
    console.log(validator.errors);
    throw "Registry fails schema validation";
  }
  else {
    console.log(`${listTitle} schema validation passed`)
  };

  /* load the doc Current Statuses and Labels */

  for (let i in registry) {

    let status = registry[i]["status"];
    var cS = ""

    if(status.draft){
      cS = "Draft"
    }
    else if(status.unknown){
      cS = "Unknown"
    }
    else if(status.withdrawn){
      cS = "Withdrawn"
    }
    else if(status.superseded){
      cS = "Superseded"
    }
    else if(status.active){
      cS = "Active"

      if (status.amended){
        cS = cS.concat(", Amended");
      }
      
      if (status.stabilized){
        cS = cS.concat(", Stabilized");
      }
      else if(status.reaffirmed){
        cS = cS.concat(", Reaffirmed");
      }

    }
    else{
      cS = "Unknown"
    }

    if(status.statusNote){
      cS = cS.concat("*");
    }

    registry[i].currentStatus = cS;

  }

  const docStatuses = {}
  registry.forEach(item => { docStatuses[item.docId] = item.currentStatus} );

  hb.registerHelper("getStatus", function(docId) {
    return docStatuses[docId];
  });

  const docLabels = {}
  registry.forEach(item => { docLabels[item.docId] = (item.label)} );

  hb.registerHelper("getLabel", function(docId) {
    return docLabels[docId];
  });

  /* is the registry sorted */
    
  for(let i = 1; i < registry.length; i++) {
    if (registry[i-1].docID >= registry[i].docID) {
      throw "Registry key " + registry[i-1].docID + " is " +
        ((registry[i-1].docID === registry[i].docID) ? "duplicated" : "not sorted");
    }
  }
  
  /* get the version field */
  
  let site_version = "Unknown version"
  
  try {
    site_version = (await execFile('git', [ 'rev-parse', 'HEAD' ])).stdout.trim()
  } catch (e) {
    console.warn(e);
  }
  
  /* create build directory */
  
  await fs.mkdir(BUILD_PATH, { recursive: true });
  
  /* apply template */
  
  var html = template({
    "data" : registry,
    "date" :  new Date(),
    "pdf_path": PDF_SITE_PATH,
    "site_version": site_version,
    "listType": listType,
    "idType": idType,
    "listTitle": listTitle
  });
  
  /* write HTML file */
  
  await fs.writeFile(path.join(BUILD_PATH, PAGE_SITE_PATH), html, 'utf8');
  
  /* copy in static resources */
  
  await Promise.all((await fs.readdir(SITE_PATH)).map(
    f => fs.copyFile(path.join(SITE_PATH, f), path.join(BUILD_PATH, f))
  ))
  
  /* write pdf */
  
  if (process.argv.slice(2).includes("--nopdf")) return;
  
  /* set the CHROMEPATH environment variable to provide your own Chrome executable */
  
  var pptr_options = {};
  
  if (process.env.CHROMEPATH) {
    pptr_options.executablePath = process.env.CHROMEPATH;
  }
  
  try {
    var browser = await puppeteer.launch(pptr_options);
    var page = await browser.newPage();
    await page.setContent(html);
    await page.pdf({ path: path.join(BUILD_PATH, PDF_SITE_PATH).toString()});
    await browser.close();
  } catch (e) {
    console.warn(e);
  }

  console.log(`Build of ${templateType} completed`)
};

module.exports = {
  buildRegistry,
}

void (async () => {

  await Promise.all(registries.map(buildRegistry))

})().catch(console.error)
