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
const sha = require('sha1');
const cheerio = require('cheerio');
const Filter = require('broccoli-filter');
const esprima = require('esprima');
const eswalk = require('esprima-walk');
const requirejs = require('requirejs');
const _ = require('lodash');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
const RSVP = require('rsvp');
var SilentError = require('silent-error');

// The root of the project
let root;

// The finger printing base urls
var fingerprintBaseUrl = '';

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
var startTemplate = _.template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

// Identifiers and Literals to replace in the code to avoid conflict with amd loader
const identifiers = {
  'require': 'eriuqer',
  'define': 'enifed'
};

const literals = {
  'require': '\'eriuqer\'',
  '(require)': '\'(eriuqer)\''
};

module.exports = {

  name: 'ember-cli-amd',

  amdModules: new Set(),

  included: function (app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules usedby the application.
    root = app.project.root;

    // This addon relies on an 'amd' options in the ember-cli-build.js file
    if (!app.options.amd) {
      return new SilentError('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
    }

    // Merge the default options
    app.options.amd = _.merge({
      loader: 'requirejs',
      packages: [],
      outputDependencyList: false,
      buildOutput: 'assets/built.js',
      inline: true
    }, app.options.amd);

    // Determine the type of loader. We only support requirejs, dojo, or the path to a cdn
    if (!app.options.amd.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }

    if ((app.options.amd.loader === 'requirejs' || app.options.amd.loader === 'dojo') && !app.options.amd.libraryPath) {
      throw new Error('ember-cli-amd: When using a local loader, you must specify its location with the amdBase property in the amd options in ember-cli-build.js.');
    }

    // The finger printing base url
    if (this.app.options.fingerprint && this.app.options.fingerprint.enabled && this.app.options.fingerprint.prepend) {
      fingerprintBaseUrl = this.app.options.fingerprint.prepend;
    }
  },

  postprocessTree: function (type, tree) {
    // Note: this function will be called once during the continuous builds. However, the tree returned will be directly manipulated.
    // It means that the de-requireing will be going on.
    if (!this.app.options.amd) {
      return tree;
    }

    if (type !== 'all') {
      return tree;
    }

    // Use the RequireFilter class to replace in the code that conflict with AMD loader
    return new RequireFilter(tree, {
      amdPackages: this.app.options.amd.packages,
      amdModules: this.amdModules
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

    // the amd builder will build the amd into a single file using requirejs build if requested.
    // If using a cdn for the amd library, this function is no-op. When the build is finished, we can update the
    // index files.
    return this.amdBuilder(result.directory, moduleInfos).then(function () {

      // There are two index files to deal with, the app index file and the test index file.
      // We need to convert them from ember style to amd style.
      // Amd style is made of 3 steps:
      // - amd configuration (optional), controlled by the his.app.options.amd.configPath
      // - loader: could be based on local build or from cdn
      // - start of the app: load the amd modules used by the app and boorstrap the app

      // Handle the amd config
      var amdConfigScript;
      if (this.app.options.amd.configPath) {

        // Read the amd config
        amdConfigScript = fs.readFileSync(path.join(root, this.app.options.amd.configPath), 'utf8');

        // If the config has to be inlined in the index then we have nothing to do at this point.
        // If the config doesn't have to be inlined then we need to copy the file and eventually fingerprint it.
        // Note that when the config is not inlined the property amdConfig is the file name. If the config
        // has to be inlined, the property amdConfig is the actual config to inline.
        if (!this.app.options.amd.inline) {

          // Only fingerprint if fingerprinting is enabled
          var amdConfigFileName = 'assets/amd-config';
          if (this.app.options.fingerprint && this.app.options.fingerprint.enabled) {
            var amdConfigSha = sha(amdConfigScript);
            amdConfigFileName += '-' + amdConfigSha;
          }
          amdConfigFileName += '.js';

          // Copy the amd config into the output directory
          fs.writeFileSync(path.join(result.directory, amdConfigFileName), amdConfigScript);

          // The amdConfig will be the file path
          amdConfigScript = amdConfigFileName;
        }
      }

      // If requested, save the list of modules used
      if (this.app.options.amd.outputDependencyList) {
        fs.writeFileSync(path.join(result.directory, 'dependencies.txt'), moduleInfos.names);
      }

      // Rebuild the app index files
      var appIndexBuildResult = this.indexBuilder({
        directory: result.directory,
        indexFile: this.app.options.outputPaths.app.html,
        indexHtmlCache: indexHtmlCache.app,
        amdConfigScript,
        startSrc: 'amd-start',
        moduleInfos
      });

      // If we are not inlining, then we need to save the start script
      if (!this.app.options.amd.inline) {
        fs.writeFileSync(path.join(result.directory, appIndexBuildResult.startFileName), beautify_js(appIndexBuildResult.startScript, {
          indent_size: 2
        }));
      }

      // Rebuild the test index file
      var testIndexBuildResult = this.indexBuilder({
        directory: result.directory,
        indexFile: 'tests/index.html',
        indexHtmlCache: indexHtmlCache.test,
        amdConfigScript,
        startSrc: 'amd-test-start',
        moduleInfos
      });

      if (!testIndexBuildResult) {
        return;
      }

      // If we are not inlining, then we need to save the start script
      if (!this.app.options.amd.inline) {
        fs.writeFileSync(path.join(result.directory, testIndexBuildResult.startFileName), beautify_js(testIndexBuildResult.startScript, {
          indent_size: 2
        }));
      }

    }.bind(this));
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
      var afterLoadingScript = scriptsToPostExecute.join('\n\n');
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
      if (this.app.options.amd.inline) {
        amdScripts += '<script>' + config.amdConfigScript + '</script>';
      } else {
        amdScripts += '<script src="' + fingerprintBaseUrl + config.amdConfigScript + '"></script>';
      }
    } else if (this.app.options.amd.configScript) {
      amdScripts += '<script>' + this.app.options.amd.configScript + '</script>';
    }

    // Add the loader
    var loaderSrc = this.app.options.amd.loader;
    if (loaderSrc === 'requirejs' || loaderSrc === 'dojo') {
      loaderSrc = config.baseUrl + 'assets/built.js';
    }
    amdScripts += `<script src="${loaderSrc}" data-amd="true"></script>`;

    // Add the start scripts
    var startScript = startTemplate(_.assign(config.moduleInfos, {
      scripts: scriptsToLoad.join(',')
    }));

    if (this.app.options.amd.inline) {
      // Inline the start script
      amdScripts += '<script>' + startScript + '</script>';
    } else {
      // fingerprint the start script if necessary
      var startFileName = 'assets/' + config.startSrc;
      if (this.app.options.fingerprint && this.app.options.fingerprint.enabled) {
        var startSha = sha(startScript);
        startFileName += '-' + startSha;
      }
      startFileName += '.js';

      // Save the file name and the script. We will save the file later.
      // The start script file needs to be saved each time the app is rebuilt in continuous build
      config.indexHtmlCache.startFileName = startFileName;
      config.indexHtmlCache.startScript = startScript;

      // All what we need to do for now is add the script tag
      amdScripts += '<script src="' + fingerprintBaseUrl + startFileName + '"></script>';
    }

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
      vendor: path.parse(this.app.options.outputPaths.vendor.js).name
    };
  },

  amdBuilder: function (directory, moduleInfos) {

    // This is an asynchronous execution. We will use RSVP to be compliant with ember-cli
    const deferred = RSVP.defer();

    // If we are using the cdn then we don't need to build
    if (this.app.options.amd.loader !== 'dojo' && this.app.options.amd.loader !== 'requirejs') {
      deferred.resolve();
      return deferred.promise;
    }

    // For dojo we need to add the dojo module in the list of modules for the build
    let modulesAsString = moduleInfos.names.join(',');
    if (this.app.options.amd.loader === 'dojo') {
      modulesAsString = `'dojo/dojo',${modulesAsString}`;
    }

    // Create the built loader file
    var boot = 'define([' + modulesAsString + '])';
    fs.writeFileSync(path.join(this.app.options.amd.libraryPath, 'main.js'), boot);

    // Define the build config
    var buildConfig = {
      baseUrl: this.app.options.amd.libraryPath,
      name: 'main',
      out: path.join(directory, 'assets/built.js'),
      optimize: 'none',
      inlineText: false,
      include: []
    };

    // For require js, we need to include the require module in the build via include
    if (this.app.options.amd.loader === 'requirejs') {
      buildConfig.include = ['../requirejs/require'];
    }

    // Merge the user build config and the default build config and build
    requirejs.optimize(_.merge(this.app.options.amd.buildConfig, buildConfig), function () {
      deferred.resolve();
    }, function (err) {
      deferred.reject(err);
    });

    return deferred.promise;
  }
};

//
// Class for replacing in the generated code the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
function RequireFilter(inputTree, options) {
  if (!(this instanceof RequireFilter)) {
    return new RequireFilter(inputTree, options);
  }

  Filter.call(this, inputTree, options); // this._super()

  options = options || {};

  this.inputTree = inputTree;
  this.files = options.files || [];
  this.description = options.description;
  this.amdPackages = options.amdPackages || [];
  this.amdModules = options.amdModules;
}

RequireFilter.prototype = Object.create(Filter.prototype);
RequireFilter.prototype.constructor = RequireFilter;

RequireFilter.prototype.extensions = ['js'];
RequireFilter.prototype.targetExtension = 'js';

RequireFilter.prototype.processString = function (code) {

  // Parse the code as an AST
  const ast = esprima.parseScript(code, {
    range: true
  });

  // Split the code into an array for easier substitutions
  const buffer = code.split('');
  const amdPackages = this.amdPackages;
  const amdModules = this.amdModules;

  // Walk thru the tree, find and replace our targets
  eswalk(ast, function (node) {
    if (!node) {
      return;
    }

    switch (node.type) {
      case 'CallExpression':

        // Collect the AMD modules
        // Looking for something like define(<name>, [<module1>, <module2>, ...], <function>)
        // This is the way ember defines a module
        if (node.callee.name !== 'define') {
          return;
        }

        if (node.arguments.length < 2 || node.arguments[1].type !== 'ArrayExpression' || !node.arguments[1].elements) {
          return;
        }

        node.arguments[1].elements.forEach(function (element) {
          if (element.type !== 'Literal') {
            return;
          }

          const isAMD = amdPackages.some(function (amdPackage) {
            if (typeof element.value !== 'string') {
              return false;
            }
            return element.value.indexOf(amdPackage + '/') === 0 || element.value === amdPackage;
          });

          if (!isAMD) {
            return;
          }

          amdModules.add(element.value);

        });
        return;

      case 'Identifier':
        {
          // We are dealing with code, make sure the node.name is not inherited from object 
          if (!identifiers.hasOwnProperty(node.name)) {
            return;
          }

          const identifier = identifiers[node.name];
          if (!identifier) {
            return;
          }

          write(buffer, identifier, node.range[0]);
        }
        return;

      case 'Literal':
        {
          // We are dealing with code, make sure the node.name is not inherited from object 
          if (!literals.hasOwnProperty(node.value)) {
            return;
          }

          const literal = literals[node.value];
          if (!literal) {
            return;
          }

          write(buffer, literal, node.range[0]);
        }
        return;
    }
  });

  // Return the new code
  return buffer.join('');
};

function write(arr, str, offset) {
  for (var i = 0, l = str.length; i < l; i++) {
    arr[offset + i] = str[i];
  }
}
