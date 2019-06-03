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
const Plugin = require('broccoli-plugin');
const walkSync = require('walk-sync');
const mkdirp = require('mkdirp');
const _ = require('lodash');

const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;

const replaceRequireAndDefine = require('./replace-require-and-define');

const configScriptPath = '/assets/amd-config.js';

// Template used to manufacture the start script
const startTemplate = _.template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

module.exports = class IndexHtmlWriter extends Plugin {
  constructor(inputNodes, options) {
    super(inputNodes, options);

    this.amdModules = options.amdModules;
    this.writeScriptsInline = options.inline;
    this.hasConfig = !!options.configPath;
    this.loaderPath = options.loader;
    this.vendorPath = options.vendorPath;
    this.indexCache = {};
  }

  build() {
    const srcDir = this.inputPaths[0];

    let configScript;
    if (this.hasConfig) {
      // Write the amd config script to the output if it exist and not writing inline
      configScript = fs.readFileSync(path.join(this.inputPaths[0], configScriptPath), 'utf8');
      if (!this.writeScriptsInline) {
        this.writeFile(configScriptPath, configScript);
      }
    }

    // Get index HTML files to modify
    const htmlPaths = walkSync(srcDir, { globs: ['**/index.html'], directories: false });
    htmlPaths.forEach((relativePath) => {
      const indexHtml = fs.readFileSync(path.join(srcDir, relativePath), 'utf8');
      this.writeIndex(relativePath, indexHtml, configScript);
    });
  }

  writeIndex(relativePath, indexHtml, configScript) {
    // Check if we have to continue
    // - If there are no scripts with the data-amd attribute then something rewrote index html and will need to reprocess the index file
    const cheerioQuery = cheerio.load(indexHtml);
    const amdScriptElements = cheerioQuery('script[data-amd]');
    if (amdScriptElements.length === 0) {
      this.indexCache[relativePath] = {};
    }

    // If no change in the modules was detected then no need to rewrite the index file
    const modulesToLoad = Array.from(this.amdModules).join(',');
    if (this.indexCache[relativePath].modules === modulesToLoad) {
      return;
    }
    this.indexCache[relativePath].modules = modulesToLoad;

    // Remove the old amdScript elements, to start the rebuild of the index file
    amdScriptElements.remove();

    let amdScripts = '';

    // Add the amd config script if present
    if (this.hasConfig) {
      if (this.writeScriptsInline) {
        amdScripts += `<script data-amd="true">${configScript}</script>`;
      } else {
        amdScripts += `<script src="${configScriptPath}" data-amd="true"></script>`;
      }
    }

    // Add the loader script
    amdScripts += `<script src="${this.loaderPath}" data-amd="true"></script>`;

    // Get the collection of scripts that need to be loaded after the amd modules have been loaded
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be run using eval
    const otherScriptElements = cheerioQuery('body > script');
    var scriptsToLoad = [];
    otherScriptElements.each(function () {
      if (cheerioQuery(this).attr('src')) {
        scriptsToLoad.push({
          src: cheerioQuery(this).attr('src')
        });
      } else {
        scriptsToLoad.push({
          code: replaceRequireAndDefine(cheerioQuery(this).html())
        });
      }
    });

    // Remove the script elements as loading and running the contents of the script elements will now be handled by the
    // amd start script
    otherScriptElements.remove();

    // Using the template, rebuild the start script that handles loading the scripts
    const startScript = startTemplate(Object.assign(this.buildModuleInfos(), {
      scripts: scriptsToLoad.map(JSON.stringify).join(',')
    }));

    // Add the start script
    if (this.writeScriptsInline) {
      amdScripts += `<script data-amd="true">${startScript}</script>`;
    } else {
      let amdStartScriptPathPrefix = path.normalize(path.dirname(relativePath)).replace('.', '').replace('/', '-');
      if (amdStartScriptPathPrefix) {
        amdStartScriptPathPrefix = amdStartScriptPathPrefix + '-';
      }
      const amdStartScriptFilePath = '/assets/' + amdStartScriptPathPrefix + 'amd-start.js'
      amdScripts += `<script src="${amdStartScriptFilePath}" data-amd="true"></script>`;
      // Write the amd start script for this index file to the output
      this.writeFile(amdStartScriptFilePath, beautify_js(startScript, { indent_size: 2 }));
    }

    // Add the scripts to the body
    cheerioQuery('body').prepend(amdScripts);

    // Beautify the index.html
    var html = beautify_html(cheerioQuery.html(), { indent_size: 2 });

    // Rewrite the index file
    this.writeFile(relativePath, html);
  }

  buildModuleInfos() {
    // Build different arrays representing the modules for the injection in the start script
    const objs = [];
    const names = [];
    const adoptables = [];
    let index = 0;
    this.amdModules.forEach(function (amdModule) {
      objs.push(`mod${index}`);
      names.push(`'${amdModule}'`);
      adoptables.push(`{name:'${amdModule}',obj:mod${index}}`);
      index++;
    });

    return {
      names: names.join(','),
      objects: objs.join(','),
      adoptables: adoptables.join(','),
      vendor: path.parse(this.vendorPath).name
    };
  }

  writeFile(relativePath, data) {
    try {
      fs.writeFileSync(path.join(this.outputPath, relativePath), data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // assume that the destination directory is missing create it and retry
        mkdirp.sync(path.join(this.outputPath, path.dirname(relativePath)));
        fs.writeFileSync(path.join(this.outputPath, relativePath), data);
      } else {
        throw err;
      }
    }
  }
}
