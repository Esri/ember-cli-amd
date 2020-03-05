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
    scriptsToLoad: []
  },
  test: {
    modulesAsString: '',
    scriptsToLoad: []
  }
};

function indexBuilder({ distDirectory, indexFile, indexHtmlCache, loaderSrc, moduleInfos } = {}) {
  // If the current index html is not the same as the one we built, it means
  // that another extension must have forced to regenerate the index html or
  // this is the first time this extension is running
  let indexPath = path.join(distDirectory, indexFile);

  let indexHtml;
  try {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    // no index file, we are done.
    return;
  }

  // Check if we have to continue
  // - If the index already contains the amd loading scripts
  // - if the list of modules is still the same
  const cheerioQuery = cheerio.load(indexHtml);
  const hasAmdScriptElement = cheerioQuery('script[data-amd]').length === 1;
  let sameModules = hasAmdScriptElement && indexHtmlCache.modulesAsString === moduleInfos.names;

  if (cheerioQuery('script[data-amd]').length !== 1) {
    // Get the collection of scripts
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process
    let scriptElements = cheerioQuery('body > script');
    let scriptsToLoad = [];
    let scriptsToPostExecute = [];
    let loadingScriptPath;
    scriptElements.each(function () {
      if (cheerioQuery(this).attr('data-amd-loading')) {
        loadingScriptPath = cheerioQuery(this).attr('src');
        return;
      }

      if (cheerioQuery(this).attr('src')) {
        scriptsToLoad.push(`"${cheerioQuery(this).attr('src')}"`);
        return;
      }

      scriptsToPostExecute.push(cheerioQuery(this).html());
    });

    // If we have inline scripts, we will save them into a script file and load it as part of the amd loading
    if (scriptsToPostExecute.length > 0) {
      let afterLoadingScript = replaceRequireAndDefine(scriptsToPostExecute.join('\n\n'));
      fs.writeFileSync(path.join(distDirectory, 'afterLoading.js'), beautify_js(afterLoadingScript, {
        indent_size: 2,
        max_preserve_newlines: 1
      }));
      scriptsToLoad.push('"afterLoading.js"');
    }
    
    // Cache the scripts to load as when we rebuild the amd loading script with them, and cache the the loading script path
    indexHtmlCache.scriptsToLoad = scriptsToLoad;
    indexHtmlCache.loadingScriptPath = loadingScriptPath;

    // Replace the original ember scripts by the amd ones
    scriptElements.remove();
    const amdScripts = [
      `<script src="${loaderSrc}" data-amd=true></script>`,
      `<script src="${loadingScriptPath}" data-amd-loading=true></script>`
    ];
    cheerioQuery('body').prepend(amdScripts.join('\n'));

    // Beautify the index.html
    let html = beautify_html(cheerioQuery.html(), {
      indent_size: 2,
      max_preserve_newlines: 0
    });

    // Rewrite the index file
    fs.writeFileSync(indexPath, html);
  }

  if (!sameModules) {
    // We have to rebuild the amd loading script.
    indexHtmlCache.modulesAsString = moduleInfos.names;

    // Add the loading script
    let loadingScript = startTemplate(_.assign(moduleInfos, {
      scripts: indexHtmlCache.scriptsToLoad.join(',')
    }));

    // Rewrite the file
    fs.writeFileSync(path.join(distDirectory, indexHtmlCache.loadingScriptPath), beautify_js(loadingScript, {
      indent_size: 2,
      max_preserve_newlines: 1
    }));
  }
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
  // - loader: could be based on local build or from cdn
  // - start of the app: load the amd modules used by the app and boorstrap the app

  // Rebuild the app index files
  indexBuilder({
    distDirectory,
    indexFile: app.options.outputPaths.app.html,
    indexHtmlCache: indexHtmlCache.app,
    loaderSrc: app.options.amd.loader,
    moduleInfos
  });

  // Rebuild the test index file
  indexBuilder({
    distDirectory,
    indexFile: 'tests/index.html',
    indexHtmlCache: indexHtmlCache.test,
    loaderSrc: app.options.amd.loader,
    moduleInfos
  });

}