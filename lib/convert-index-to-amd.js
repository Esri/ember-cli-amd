// Copyright 2015 Esri
// Licensed under The MIT License(MIT);
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//   http://opensource.org/licenses/MIT
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
const _ = require('lodash');

const replaceRequireAndDefine = require('./replace-require-and-define');

// Template used to manufacture the start script
const startTemplate = _.template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

function buildModuleInfos(app, externalAmdModules) {

  // Build different arrays representing the modules for the injection in the start script
  const objs = [];
  const names = [];
  const adoptables = [];
  let index = 0;
  externalAmdModules.forEach((externalAmdModule) => {
    objs.push(`mod${index}`);
    names.push(`'${externalAmdModule}'`);
    adoptables.push(`{name:'${externalAmdModule}',obj:mod${index}}`);
    index++;
  });

  return {
    names: names.join(','),
    objects: objs.join(','),
    adoptables: adoptables.join(','),
    vendor: path.parse(app.options.outputPaths.vendor.js).name
  };
}

// For continuous build, we need to cache a series of properties
const indexHtmlCache = {
  app: {
    modulesAsString: '',
    startScript: '',
    startFileName: ''
  },
  test: {
    modulesAsString: '',
    startScript: '',
    startFileName: ''
  }
};

function indexBuilder({ distDirectory, indexFile, indexHtmlCache, loaderSrc, amdConfigScript, moduleInfos } = {}) {
  // If the current index html is not the same as the one we built, it means
  // that another extension must have forced to regenerate the index html or
  // this is the first time this extension is running
  let indexPath = path.join(distDirectory, indexFile);

  let indexHtml;
  try {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    // no index file, we are done.
    return null;
  }

  // Check if we have to continue
  // - If the index already contains the AMD loader
  // - if the list of modules is still the same
  const cheerioQuery = cheerio.load(indexHtml);
  const amdScriptElements = cheerioQuery('script[data-amd]')
  if (amdScriptElements.length === 1 && indexHtmlCache.modulesAsString === moduleInfos.names) {
    return indexHtmlCache;
  }

  // Get the collection of scripts
  // Scripts that have a 'src' will be loaded by AMD
  // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process
  let scriptElements = cheerioQuery('body > script');
  let scriptsToLoad = [];
  let scriptsToPostExecute = [];
  scriptElements.each(function () {
    if (cheerioQuery(this).attr('src')) {
      scriptsToLoad.push(`"${cheerioQuery(this).attr('src')}"`)
    } else {
      scriptsToPostExecute.push(cheerioQuery(this).html());
    }
  });

  // Remove the script tags
  scriptElements.remove();

  // If we have scripts that have to be executed after the AMD load, then serialize them into a file
  // afterLoading.js and add this file to the list of AMD modules.
  if (scriptsToPostExecute.length > 0) {
    let afterLoadingScript = replaceRequireAndDefine(scriptsToPostExecute.join('\n\n'));
    fs.writeFileSync(path.join(distDirectory, 'afterLoading.js'), beautify_js(afterLoadingScript, {
      indent_size: 2
    }));
    scriptsToLoad.push('"/afterLoading.js"');
  }

  // We have to rebuild this index file.
  indexHtmlCache.modulesAsString = moduleInfos.names;

  // Add the amd config
  let amdScripts = '';
  if (amdConfigScript) {
    amdScripts += '<script>' + amdConfigScript + '</script>';
  }

  // Add the loader
  amdScripts += `<script src="${loaderSrc}" data-amd="true"></script>`;

  // Add the start scripts
  let startScript = startTemplate(_.assign(moduleInfos, {
    scripts: scriptsToLoad.join(',')
  }));

  // Inline the start script
  amdScripts += '<script>' + startScript + '</script>';

  // Add the scripts to the body
  cheerioQuery('body').prepend(amdScripts);

  // Beautify the index.html
  let html = beautify_html(cheerioQuery.html(), {
    indent_size: 2
  });

  // Rewrite the index file
  fs.writeFileSync(indexPath, html);

  return indexHtmlCache;
}

// Class for replacing in the generated code the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
module.exports = function convertIndexToAmdFilter(app, distDirectory, externalAmdModules) {

  if (!app.options.amd) {
    return;
  }

  // Get the modules information
  const moduleInfos = buildModuleInfos(app, externalAmdModules);

  // There are two index files to deal with, the app index file and the test index file.
  // We need to convert them from ember style to amd style.
  // Amd style is made of 3 steps:
  // - amd configuration (optional), controlled by the his.app.options.amd.configPath
  // - loader: could be based on local build or from cdn
  // - start of the app: load the amd modules used by the app and boorstrap the app

  // Handle the amd config
  let amdConfigScript = app.options.amd.configScript;
  if (app.options.amd.configPath) {
    amdConfigScript = fs.readFileSync(path.join(app.project.root, app.options.amd.configPath), 'utf8');
  }

  // Rebuild the app index files
  indexBuilder({
    distDirectory,
    indexFile: app.options.outputPaths.app.html,
    indexHtmlCache: indexHtmlCache.app,
    loaderSrc: app.options.amd.loader,
    amdConfigScript,
    moduleInfos
  });
  
  // Rebuild the test index file
  indexBuilder({
    distDirectory,
    indexFile: 'tests/index.html',
    indexHtmlCache: indexHtmlCache.test,
    loaderSrc: app.options.amd.loader,
    amdConfigScript,
    moduleInfos
  });

}