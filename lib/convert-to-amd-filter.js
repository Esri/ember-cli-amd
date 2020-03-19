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
const Filter = require('broccoli-filter');
const cheerio = require('cheerio');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
const _ = require('lodash');

const replaceRequireAndDefine = require('./replace-require-and-define');

const amdLoadingTemplate = _.template(fs.readFileSync(path.join(__dirname, 'amd-loading.txt'), 'utf8'));
const indexFiles = ['index.html', 'tests/index.html'];

// Class for replacing, in the generated code, the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
module.exports = class ConvertToAMD extends Filter {
  constructor(app, inputTree, options = {}) {
    super(inputTree, options);

    this.extensions = ['js', 'html'];

    // Options for the process
    this.loader = app.options.amd.loader;
    this.amdPackages = app.options.amd.packages || [];
    this.excludePaths = app.options.amd.excludePaths;
    this.loadingFilePath = (app.options.amd.loadingFilePath || 'assets').replace(/\/$/, "");
    this.rootURL = app.project.config(app.env).rootURL;

    // Because the filter is call for partial rebuild during 'ember serve', we need to 
    // know what was added/removed for a partial build
    this.externalAmdModules = new Set();
    this.externalAmdModulesCache = new Map();

    // There are two index files that should be converted:
    // - index.html
    // - tests/index.html
    // We need to keep things separated as they don't load the same script set.
    this.indexHtmlCaches = {
      'index.html': {
        scriptsToLoad: [],
        loadingScript: this.rootURL + this.loadingFilePath + '/amd-loading.js',
        afterLoadingScript: this.rootURL + this.loadingFilePath + '/after-amd-loading.js'
      },
      'tests/index.html': {
        scriptsToLoad: [],
        loadingScript: this.rootURL + this.loadingFilePath + '/amd-loading-tests.js',
        afterLoadingScript: this.rootURL + this.loadingFilePath + '/after-amd-loading-tests.js'
      }
    };
  }

  getDestFilePath(relativePath) {
    relativePath = super.getDestFilePath(relativePath);
    if (!relativePath) {
      return null;
    }

    if (relativePath.indexOf('index.html') >= 0) {
      return relativePath;
    }

    for (let i = 0, len = this.excludePaths.length; i < len; i++) {
      if (relativePath.indexOf(this.excludePaths[i]) === 0) {
        return null;
      }
    }

    if (relativePath.indexOf('.js') >= 0) {
      return relativePath;
    }

    return null;
  }

  processString(code, relativePath) {
    if (relativePath.indexOf('.js') >= 0) {
      return this._processJsFile(code, relativePath);
    }

    return this._processIndexFile(code, relativePath);
  }

  _processIndexFile(code, relativePath) {

    const cheerioQuery = cheerio.load(code);

    // Get the collection of scripts
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process
    const scriptElements = cheerioQuery('body > script');
    const scriptsToLoad = [];
    const inlineScripts = [];
    scriptElements.each(function () {
      if (cheerioQuery(this).attr('src')) {
        scriptsToLoad.push(`"${cheerioQuery(this).attr('src')}"`);
      } else {
        inlineScripts.push(cheerioQuery(this).html());
      }
    });

    this.indexHtmlCaches[relativePath].scriptsToLoad = scriptsToLoad;

    // If we have inline scripts, we will save them into a script file and load it as part of the amd loading
    if (inlineScripts.length > 0) {
      const afterLoadingScript = replaceRequireAndDefine(inlineScripts.join('\n\n'));
      fs.writeFileSync(path.join(this.outputPath, this.indexHtmlCaches[relativePath].afterLoadingScript), beautify_js(afterLoadingScript, {
        indent_size: 2,
        max_preserve_newlines: 1
      }));
      scriptsToLoad.push(`"${this.indexHtmlCaches[relativePath].afterLoadingScript}"`);
    }

    // Replace the original ember scripts by the amd ones
    scriptElements.remove();
    const amdScripts = [
      `<script src="${this.loader}" data-amd=true></script>`,
      `<script src="${this.indexHtmlCaches[relativePath].loadingScript}" data-amd-loading=true></script>`
    ];
    cheerioQuery('body').prepend(amdScripts.join('\n'));

    // Beautify the index.html
    return beautify_html(cheerioQuery.html(), {
      indent_size: 2,
      max_preserve_newlines: 0
    });
  }

  _processJsFile(code, relativePath) {

    const externalAmdModulesForFile = new Set();
    const modifiedSource = replaceRequireAndDefine(code, this.amdPackages, externalAmdModulesForFile);

    // Bookkeeping of what has changed for this file compared to previous builds
    if (externalAmdModulesForFile.size === 0) {
      // No more AMD references
      this.externalAmdModulesCache.delete(relativePath);
    } else {
      // Replace with the new set
      this.externalAmdModulesCache.set(relativePath, externalAmdModulesForFile);
    }

    return modifiedSource;
  }

  _buildModuleInfos() {

    // Build different arrays representing the modules for the injection in the start script
    const objs = [];
    const names = [];
    const adoptables = [];
    let index = 0;
    this.externalAmdModules.forEach((externalAmdModule) => {
      objs.push(`mod${index}`);
      names.push(`'${externalAmdModule}'`);
      adoptables.push(`{name:'${externalAmdModule}',obj:mod${index}}`);
      index++;
    });

    return {
      names: names.join(','),
      objects: objs.join(','),
      adoptables: adoptables.join(',')
    };
  }

  async build() {

    // Cache the previous state
    let moduleInfos = this._buildModuleInfos();
    const names = moduleInfos.names;

    const scripts = indexFiles.reduce((scripts, indexFile) => {
      scripts[indexFile] = this.indexHtmlCaches[indexFile].scriptsToLoad.join(',');
      return scripts;
    }, {});

    // Clear before each build since the filter is kept by ember-cli during 'ember serve' 
    // and being reused without going thru postProcessTree. If we don't clean we may get 
    // previous modules.
    this.externalAmdModules.clear();

    const result = await super.build();

    // Re-assemble the external AMD modules set with the updated cache
    this.externalAmdModulesCache.forEach(externalAmdModules => {
      externalAmdModules.forEach(externalAmdModule => {
        this.externalAmdModules.add(externalAmdModule);
      });
    });

    // Check if we have a new set of amd modules or a new set of scripts to load.
    // If we have then we need to rebuild the amd loading script
    moduleInfos = this._buildModuleInfos();
  
    indexFiles.forEach(indexFile => {
      
      const newScripts = this.indexHtmlCaches[indexFile].scriptsToLoad.join(',');
      const previousScripts = scripts[indexFile];
      if (names !== moduleInfos.names || previousScripts !== newScripts) {
        
        const loadingScript = amdLoadingTemplate(_.assign(moduleInfos, {
          scripts: newScripts
        }));
  
        fs.writeFileSync(path.join(this.outputPath, this.indexHtmlCaches[indexFile].loadingScript), beautify_js(loadingScript, {
          indent_size: 2,
          max_preserve_newlines: 1
        }));
      }
  
    });

    return result;
  }
}