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
const merge = require('lodash/object/merge');
const template = require('lodash/string/template');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
const RSVP = require('rsvp');

// The root of the project
let root;

// The finger printing base urls
var fingerprintBaseUrl = '';

// The set of AMD module names used in application. If this addon is used under
// continuous build (ember build --watch or ember serve), we need to verify that
// things have not changed in between two same function calls. We need variables
// to capture the sate
var modules = [];
var modulesAsString = '';

// For contiinuous build, we need to cache a series of properties
var indexHtml = {
  app: {
    original: '',
    amd: '',
    scriptsAsString: '',
    modulesAsString: '',
    startScript: '',
    startFileName: ''
  },
  test: {
    original: '',
    amd: '',
    scriptsAsString: '',
    modulesAsString: '',
    startScript: '',
    startFileName: ''
  }
};

// i18n locale
var locale;

// Template used to manufacture the start script
var startTemplate = template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

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

  included: function (app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules usedby the application.
    root = app.project.root;

    // This addon relies on an 'amd' options in the ember-cli-build.js file
    if (!app.options.amd) {
      console.log('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
      return;
    }

    // Merge the default options
    app.options.amd = merge({
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
    if (!this.app.options.amd) {
      return tree;
    }

    if (type !== 'all') {
      return tree;
    }

    // Use the RequireFilter class to replace in the code that conflict with AMD loader
    return new RequireFilter(tree);
  },

  postBuild: function (result) {

    if (!this.app.options.amd) {
      return;
    }

    // When ember build --watch or ember serve are used, this function will be called over and over
    // as a user updates code. We need to figure what we have to build or copy.

    // the amd builder will build the amd into a single file using requirejs build if requested.
    // If using a cdn for the amd library, this function is no-op. When the build is finished, we can update the
    // index files.
    return this.amdBuilder(result.directory).then(function () {

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

      // Get the modules information
      var modulesInfo = this.getModulesInfo();

      // If requested, save the list of modules used
      if (this.app.options.amd.outputDependencyList) {
        fs.writeFileSync(path.join(result.directory, 'dependencies.txt'), modulesInfo.names);
      }

      // Rebuild the app index files
      var appIndexBuildResult = this.indexBuilder({
        directory: result.directory,
        indexFile: this.app.options.outputPaths.app.html,
        indexHtml: indexHtml.app,
        amdConfigScript: amdConfigScript,
        startSrc: 'amd-start',
        modules: modulesInfo
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
        indexHtml: indexHtml.test,
        amdConfigScript: amdConfigScript,
        startSrc: 'amd-test-start',
        modules: modulesInfo
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

    var currentIndexHtml;
    try {
      currentIndexHtml = fs.readFileSync(indexPath, 'utf8');
    } catch (e) {
      // no index file, we are done.
      return null;
    }

    // Check if we have to continue
    // - if the current index file match the one we built then the index file has not been regenerated
    // - if the list of modules is still the same
    if (currentIndexHtml === config.indexHtml.amd && config.indexHtml.modulesAsString === config.modules.names) {
      return config.indexHtml;
    }

    // If the current index file do not match the one we built, it's new one that got regenerated
    if (config.indexHtml.amd !== currentIndexHtml) {
      config.indexHtml.original = currentIndexHtml;
    }

    // Get the collection of scripts from the original index file
    // Note that we don't cae about re-computing this list
    var cheerioQuery = cheerio.load(config.indexHtml.original);
    var scriptElements = cheerioQuery('body > script');
    var scripts = [];
    var scriptsWithSrc = scriptElements.filter(function () {
      return cheerioQuery(this).attr('src') !== undefined;
    });
    scriptsWithSrc.each(function () {
      scripts.push("'" + cheerioQuery(this).attr('src') + "'");
    });

    // We have to rebuild this index file. Cache the new properties
    config.indexHtml.scriptsAsString = scripts.join(',');
    config.indexHtml.modulesAsString = config.modules.names;

    // Remove the scripts tagcd
    scriptsWithSrc.remove();

    // Add the amd config
    var amdScripts = '';
    if (this.app.options.amd.configPath) {
      if (this.app.options.amd.inline) {
        amdScripts += '<script>' + config.amdConfigScript + '</script>';
      } else {
        amdScripts += '<script src="' + fingerprintBaseUrl + config.amdConfigScript + '"></script>';
      }
    }

    // Add the loader
    var loaderSrc = this.app.options.amd.loader;
    if (loaderSrc === 'requirejs' || loaderSrc === 'dojo') {
      loaderSrc = config.baseUrl + 'assets/built.js';
    }
    amdScripts += '<script src="' + loaderSrc + '"></script>';

    // Add the start scripts
    var startScript = startTemplate(_.assign(config.modules, {
      scripts: config.indexHtml.scriptsAsString
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
      config.indexHtml.startFileName = startFileName;
      config.indexHtml.startScript = startScript;

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

    // Save the index we built for futire comparaison
    config.indexHtml.amd = html;

    return config.indexHtml;
  },

  getModulesInfo: function () {

    // Build different arrays representing the modules for the injection in the start script
    var objs = modules.map(function (module, i) {
      return 'mod' + i;
    });
    var names = modules.map(function (module) {
      return "'" + module + "'";
    });
    var adoptables = names.map(function (name, i) {
      return '{name:' + name + ',obj:' + objs[i] + '}';
    });

    return {
      names: names.join(','),
      objects: objs.join(','),
      adoptables: adoptables.join(','),
      vendor: path.parse(this.app.options.outputPaths.vendor.js).name
    };
  },

  findAMDModules: function () {

    // Get the list of javascript files fromt the application
    var jsFiles = walk(path.join(root, 'app')).filter(function (file) {
      return file.indexOf('.js') > -1;
    });

    // Collect the list of modules used from the amd packages
    var amdModules = [];
    var packages = this.app.options.amd.packages;
    jsFiles.forEach(function (file) {
      // Use esprima to parse the javascript file and build the code tree
      var f = fs.readFileSync(file, 'utf8');
      var ast = esprima.parse(f, {
        sourceType: 'module'
      });

      // Walk thru the esprima nodes and collect the amd modules from the import statements
      eswalk(ast, function (node) {
        var amdModule = getAMDModule(node, packages);
        if (!amdModule) {
          return;
        }
        amdModules.push(amdModule);
      });
    });

    return _.uniq(amdModules).sort();
  },

  amdBuilder: function (directory) {

    // Refresh the list of modules
    modules = this.findAMDModules();
    modulesAsString = modulesToString(modules);

    // This is an asynchronous execution. We will use RSVP to be compliant with ember-cli
    var deferred = RSVP.defer();

    // If we are using the cdn then we don't need to build
    if (this.app.options.amd.loader !== 'dojo' && this.app.options.amd.loader !== 'requirejs') {
      deferred.resolve();
      return deferred.promise;
    }

    // For dojo we need to add the dojo module in the list of modules for the build
    if (this.app.options.amd.loader === 'dojo') {
      modulesAsString = '"dojo/dojo",' + modulesAsString;
    }

    // Create the built loader file
    var boot = 'define([' + modulesAsString + '])';
    fs.writeFileSync(path.join(this.app.options.amd.libraryPath, 'main.js'), boot);

    // Define the build config
    var buildConfig = {
      baseUrl: this.app.options.amd.libraryPath,
      name: 'main',
      out: path.join(directory, 'assets/built.js'),
      locale: locale,
      optimize: 'none',
      inlineText: false,
      include: []
    };

    // For require js, we need to include the require module in the build via include
    if (this.app.options.amd.loader === 'requirejs') {
      buildConfig.include = ['../requirejs/require'];
    }

    // Merge the user build config and the default build config and build
    requirejs.optimize(merge(this.app.options.amd.buildConfig, buildConfig), function () {
      deferred.resolve();
    }, function (err) {
      deferred.reject(err);
    });

    return deferred.promise;
  }
};

function modulesToString(modules) {
  return modules.map(function (module) {
    return '"' + module + '"';
  }).join(',');
}

function walk(dir) {
  // Recursively walk thru a directory and returns the collection of files
  var results = [];
  var list = fs.readdirSync(dir);
  list.forEach(function (file) {
    file = path.join(dir, file);
    var stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else results.push(file);
  });
  return results;
}

function getAMDModule(node, packages) {

  // It's possible that esprima parsed some nodes as undefined
  if (!node) {
    return null;
  }

  // We are only interested by the import declarations
  if (node.type !== 'ImportDeclaration') {
    return null;
  }

  // Should not happen but we never know
  if (!node.source || !node.source.value) {
    return null;
  }

  // Should not happen but we never know
  var module = node.source.value;
  if (!module.length) {
    return null;
  }

  // Test if the module name starts with one of the AMD package names.
  // If so then it's an AMD module we can return it otherwise return null.
  var isAMD = packages.some(function (p) {
    return module.indexOf(p + '/') === 0 || module === p;
  });

  return isAMD ? module : null;
}

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
}

RequireFilter.prototype = Object.create(Filter.prototype);
RequireFilter.prototype.constructor = RequireFilter;

RequireFilter.prototype.extensions = ['js'];
RequireFilter.prototype.targetExtension = 'js';

RequireFilter.prototype.processString = function(code) {

  // Parse the code as an AST
  const ast = esprima.parseScript(code, {
    range: true
  });

  // Split the code into an array for easier substitutions
  const buffer = code.split('');

  // Walk thru the tree, find and replace our targets
  eswalk(ast, function (node) {
    if (!node) {
      return;
    }

    switch (node.type) {
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
