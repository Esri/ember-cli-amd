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

/* jshint node: true */
'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const _ = require('lodash');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;

const ReplaceRequireAndDefineFilter = require('./lib/replace-require-and-define-filter');

// The root of the project
let root;

// For contiinuous build, we need to cache a series of properties
var indexHtmlCache = {
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

// Template used to manufacture the start script
const startTemplate = _.template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));


module.exports = {

  name: 'ember-cli-amd',

  externalAmdModules: new Set(),

  included: function (app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules usedby the application.
    root = app.project.root;

    // This addon relies on an 'amd' options in the ember-cli-build.js file
    if (!app.options.amd) {
      return new Error('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
    }

    // Merge the default options
    app.options.amd = Object.assign({
      packages: [],
      excludePaths: []
    }, app.options.amd);

    // Determine the type of loader.
    if (!app.options.amd.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }

    if (app.options.amd.configPath) {
      const configPath = app.options.amd.configPath;
      if (!fs.existsSync(path.join(app.project.root, configPath))) {
        throw new Error(`ember-cli-amd: The file specified in the configPath option "${configPath}" does not exist`);
      }
    }
  },

  postprocessTree: function (type, tree) {
    // Note: this function will be called once during the continuous builds. However, the tree returned will be directly manipulated.
    // It means that the de-requireing will be going on.
    if (type !== 'all') {
      return tree;
    }

    // Use the RequireFilter class to replace in the code that conflict with AMD loader
    this.externalAmdModules.clear();
    return new ReplaceRequireAndDefineFilter(tree, {
      amdPackages: this.app.options.amd.packages,
      externalAmdModules: this.externalAmdModules,
      excludePaths: this.app.options.amd.excludePaths
    });
  },

  postBuild: function (result) {

    if (!this.app.options.amd) {
      return;
    }

    // When ember build --watch or ember serve are used, this function will be called over and over
    // as a user updates code. We need to figure what we have to build or copy.

    // Get the modules information
    const moduleInfos = this.buildModuleInfos();

    // There are two index files to deal with, the app index file and the test index file.
    // We need to convert them from ember style to amd style.
    // Amd style is made of 3 steps:
    // - amd configuration (optional), controlled by the his.app.options.amd.configPath
    // - loader: could be based on local build or from cdn
    // - start of the app: load the amd modules used by the app and boorstrap the app

    // Handle the amd config
    var amdConfigScript;
    if (this.app.options.amd.configPath) {
      amdConfigScript = fs.readFileSync(path.join(root, this.app.options.amd.configPath), 'utf8');
    }

    // Rebuild the app index files
    this.indexBuilder({
      directory: result.directory,
      indexFile: this.app.options.outputPaths.app.html,
      indexHtmlCache: indexHtmlCache.app,
      amdConfigScript,
      startSrc: 'amd-start',
      moduleInfos
    });

    // Rebuild the test index file
    this.indexBuilder({
      directory: result.directory,
      indexFile: 'tests/index.html',
      indexHtmlCache: indexHtmlCache.test,
      amdConfigScript,
      startSrc: 'amd-test-start',
      moduleInfos
    });
  },

  indexBuilder: function (config) {
    // If the current index html is not the same as teh one we built, it means
    // that another extension must have forced to regenerate the index html or
    // this is the first time this extension is running
    var indexPath = path.join(config.directory, config.indexFile);

    var indexHtml;
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
    if (amdScriptElements.length === 1 && config.indexHtmlCache.modulesAsString === config.moduleInfos.names) {
      return config.indexHtmlCache;
    }

    // Get the collection of scripts
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process
    var scriptElements = cheerioQuery('body > script');
    var scriptsToLoad = [];
    var scriptsToPostExecute = [];
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
      var afterLoadingScript = replaceRequireAndDefine(scriptsToPostExecute.join('\n\n'));
      fs.writeFileSync(path.join(config.directory, 'afterLoading.js'), beautify_js(afterLoadingScript, {
        indent_size: 2
      }));
      scriptsToLoad.push('"/afterLoading.js"');
    }

    // We have to rebuild this index file.
    config.indexHtmlCache.modulesAsString = config.moduleInfos.names;

    // Add the amd config
    var amdScripts = '';
    if (this.app.options.amd.configPath) {
      amdScripts += '<script>' + config.amdConfigScript + '</script>';
    } else if (this.app.options.amd.configScript) {
      amdScripts += '<script>' + this.app.options.amd.configScript + '</script>';
    }

    // Add the loader
    var loaderSrc = this.app.options.amd.loader;
    amdScripts += `<script src="${loaderSrc}" data-amd="true"></script>`;

    // Add the start scripts
    var startScript = startTemplate(_.assign(config.moduleInfos, {
      scripts: scriptsToLoad.join(',')
    }));

    // Inline the start script
    amdScripts += '<script>' + startScript + '</script>';

    // Add the scripts to the body
    cheerioQuery('body').prepend(amdScripts);

    // Beautify the index.html
    var html = beautify_html(cheerioQuery.html(), {
      indent_size: 2
    });

    // Rewrite the index file
    fs.writeFileSync(indexPath, html);

    return config.indexHtmlCache;
  },

  buildModuleInfos: function () {

    // Build different arrays representing the modules for the injection in the start script
    const objs = [];
    const names = [];
    const adoptables = [];
    let index = 0;
    this.externalAmdModules.forEach(function (amdModule) {
      objs.push(`mod${index}`);
      names.push(`'${amdModule}'`);
      adoptables.push(`{name:'${amdModule}',obj:mod${index}}`);
      index++;
    });

    return {
      names: names.join(','),
      objects: objs.join(','),
      adoptables: adoptables.join(','),
      vendor: path.parse(this.app.options.outputPaths.vendor.js).name
    };
  }
};


