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

const argv = require('yargs').argv;
const { readFile, writeFile } = require('fs').promises;
const { json2csvAsync } = require('json-2-csv');

/* list the available registries type (lower case), id (single, for links), titles (Upper Case), and schema builds */

const registries = [
  {
    "listType": "documents",
    "templateType": "documents",
    "templateName": "index",
    "idType": "document",
    "listTitle": "Documents",
    "subRegistry": [
      "groups",
      "projects"
    ]
  }
]

/* load and build the templates */

async function buildRegistry ({ listType, templateType, templateName, idType, listTitle, subRegistry }) {
  console.log(`Building ${templateType} started`)

  var DATA_PATH = path.join(REGISTRIES_REPO_PATH, "data/" + listType + ".json");
  var DATA_SCHEMA_PATH = path.join(REGISTRIES_REPO_PATH, "schemas/" + listType + ".schema.json");
  var TEMPLATE_PATH = "src/main/templates/" + templateName + ".hbs";
  var PAGE_SITE_PATH = templateName + ".html";
  var PDF_SITE_PATH = templateType + ".pdf";
  var CSV_SITE_PATH = templateType + ".csv";
  const inputFileName = DATA_PATH;
  const outputFileName = BUILD_PATH + "/" + CSV_SITE_PATH;

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
  
  const validateRegistries = [
    {
      type: listType,
      DATA_PATH: DATA_PATH,
      DATA_SCHEMA_PATH: DATA_SCHEMA_PATH 
    }
  ]

  for (let i in subRegistry) {
    var subReg = {}
    subReg["type"] = subRegistry[i]
    subReg["DATA_PATH"] = DATA_PATH.replace(listType, subRegistry[i])
    subReg["DATA_SCHEMA_PATH"] = DATA_SCHEMA_PATH.replace(listType, subRegistry[i])
    validateRegistries.push(subReg);
  }

  for (let i in validateRegistries) {
  
    validateRegistries[i].registry = JSON.parse(
      await fs.readFile(validateRegistries[i].DATA_PATH)
    );
    if (!validateRegistries[i].registry) {
      throw "Cannot load registry";
    }

    if (validateRegistries[i].type == "documents") {
      registry = validateRegistries[i].registry
    }
    else if (validateRegistries[i].type == "groups") {
      groupRegistry = validateRegistries[i].registry
    }
    else if (validateRegistries[i].type == "projects") {
      projectRegistry = validateRegistries[i].registry
    }
    
    console.log(`${validateRegistries[i].DATA_PATH} schema validation started`)

    var validator_factory = new ajv();
    let validator = validator_factory.compile(
      JSON.parse(await fs.readFile(validateRegistries[i].DATA_SCHEMA_PATH))
    );
    
    if (! validator(validateRegistries[i].registry)) {
      console.log(validator.errors);  
      throw "Registry fails schema validation";
    }
    else {
      console.log(`${validateRegistries[i].DATA_PATH} schema validation passed`)
    };

  }

  /* load the SMPTE abreviated docType */

  for (let i in registry) {

    if (registry[i]["publisher"] == "SMPTE"){

      let docType = registry[i]["docType"];
      var dTA = ""

      if(docType == "Administrative Guideline"){
        dTA = "AG"
      }
      else if(docType == "Advisory Note"){
        dTA = "AN"
      }
      else if(docType == "Engineering Guideline"){
        dTA = "EG"
      }
      else if(docType == "Engineering Report"){
        dTA = "ER"
      }
      else if(docType == "Operations Manual"){
        dTA = "OM"
      }
      else if(docType == "Overview Document"){
        dTA = "EG"
      }
      else if(docType == "Recommended Practice"){
        dTA = "RP"
      }
      else if(docType == "Registered Disclosure Document"){
        dTA = "RDD"
      }
      else if(docType == 'Specification'){
        dTA = "TSP"
      }
      else if(docType == 'Standard'){
        dTA = "ST"
      }
      else if(docType == 'Study Group Report'){
        dTA = "SGR"
      }
      registry[i].docTypeAbr = dTA;
    }
  }

  /* load the doc Current Statuses and Labels */

  for (let i in registry) {

    let status = registry[i]["status"];
    var cS = ""

    if(status.draft){
      cS = "Draft"
      if (status.publicCd){
        cS = cS.concat(", Public CD");
      }
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

  /* create Status Button and Label based on current document status */

  hb.registerHelper("getstatusButton", function(docId, btnSize) {
    
    var status = docStatuses[docId]

    if (status.includes("Active")) { 
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + btnSize + '" height="' + btnSize + '" fill="#0c9c16" class="bi bi-check-circle-fill align-baseline" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>'; 
    }
    else if (status.includes("Superseded") || status.includes("Withdrawn")){
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + btnSize + '" height="' + btnSize + '" fill="#ff0000" class="bi bi-slash-circle-fill align-baseline" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-4.646-2.646a.5.5 0 0 0-.708-.708l-6 6a.5.5 0 0 0 .708.708l6-6z"/></svg>'
    }
    else {
      return "";
    }

    return docStatuses[docId];
  });

  const docLabels = {}
  registry.forEach(item => { docLabels[item.docId] = (item.docLabel)} );

  hb.registerHelper("getLabel", function(docId) {
    return docLabels[docId];
  });

  /* lookup if any projects exist for current document */

  const docProjs = []
  for (let i in projectRegistry) {

    
    let projs = projectRegistry[i]["docAffected"]

    for (let p in projs) {

      var docProj = {}

      docProj["docId"] = projs[p]
      docProj["workType"] = projectRegistry[i]["workType"]
      docProj["projectStatus"] = projectRegistry[i]["projectStatus"]
      docProj["newDoc"] = projectRegistry[i]["docId"]
      docProjs.push(docProj)

    }
  }

  hb.registerHelper('docProjLookup', function(collection, id) {
      var collectionLength = collection.length;

      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].docId === id) {
              return collection[i];
          }
      }
      return null;
  });

  /* external json lookup helpers */

  hb.registerHelper('groupIdLookup', function(collection, id) {
      var collectionLength = collection.length;

      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].groupId === id) {
              return collection[i];
          }
      }
      return null;
  });

  hb.registerHelper('projectIdLookup', function(collection, id) {
      var collectionLength = collection.length;

      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].projectId === id) {
              return collection[i];
          }
      }
      return null;
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
    "data_groups" : groupRegistry,
    "data_projects" : projectRegistry,
    "docProjs": docProjs,
    "date" :  new Date(),
    "pdf_path": PDF_SITE_PATH,
    "csv_path": CSV_SITE_PATH,
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

  async function parseJSONFile (fileName) {
    try {
      const file = await readFile(fileName);
      return JSON.parse(file);
    } catch (err) {
      console.log(err);
      process.exit(1);
    }
  }

  async function writeCSV (fileName, data) {
    await writeFile(fileName, data, 'utf8');
  }

  (async () => {
    const data = await parseJSONFile(inputFileName);
    const csv = await json2csvAsync(data);
    await writeCSV(outputFileName, csv);
  })();

  console.log(`Build of ${templateType} completed`)
};

module.exports = {
  buildRegistry,
}

void (async () => {

  await Promise.all(registries.map(buildRegistry))

})().catch(console.error)
