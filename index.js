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

var fs = require('fs');
var path = require('path');
var stringReplace = require('broccoli-string-replace');
var sha = require('sha1');
var cheerio = require('cheerio');
var esprima = require('esprima');
var eswalk = require('esprima-walk');
var replaceall = require('replaceall');
var strip = require('strip-comments');
var requirejs = require('requirejs');
var _ = require('lodash');
var merge = require('lodash/object/merge');
var template = require('lodash/string/template');
var beautify_js = require('js-beautify');
var beautify_html = require('js-beautify').html;
var RSVP = require('rsvp');

// The root of the project
var root;
// The amd options
var amdOptions;
// The output paths options
var outputPaths;
// The set of AMD module names used in application. If this addon is used under
// continuous build (ember build --watch or ember serve), we need to verify that
// things have not changed in between two same function calls. We need variables
// to capture the sate
var modules = [];
var modulesAsString = '';
// The list of scripts from inside the index files
var scriptsAsString;
var testScriptsAsString;
// The sha of the config file and the built index files
var indexSha;
var testIndexSha;
// i18n locale
var locale;
// Template used to manufacture the start script
var startTemplate = template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

var findAMDModules = function findAMDModules() {
  
  // Get the list of javascript files fromt the application
  var jsFiles = walk(path.join(root, 'app')).filter(function (file) {
    return file.indexOf('.js') > -1;
  });
  
  // Collect the list of modules used from the amd packages
  var amdModules = [];
  jsFiles.forEach(function (file) {
    // Use esprima to parse the javascript file and build the code tree
    var f = fs.readFileSync(file, 'utf8');
    var ast = esprima.parse(f, { sourceType: 'module' });
    
    // Walk thru the esprima nodes and collect the amd modules from the import statements 
    eswalk(ast, function (node) {
      var amdModule = getAMDModule(node, amdOptions.packages);
      if (!amdModule)
        return;
      amdModules.push(amdModule);
    });
  });

  return _.uniq(amdModules).sort();
};

var modulesToString = function modulesToString(modules) {
  return modules.map(function (module) { return '"' + module + '"'; }).join(',');
};

var amdBuilder = function amdBuilder(modulesAsString, directory) {
  
  // Get the list of modules, we will use it to compare it against the previous one an decide
  // what needs to be rebuilt.    
  var newModules = findAMDModules();
  var newModulesAsString = modulesToString(newModules);

  var amdRefreshed = newModulesAsString !== modulesAsString;

  // Update the state
  modules = newModules;
  modulesAsString = newModulesAsString;

  // This is an asynchronous execution. We will use RSVP to be compliant with ember-cli
  var deferred = RSVP.defer();

  // If we are using the cdn then we don't need to build
  if (amdOptions.loader !== 'dojo' && amdOptions.loader !== 'requirejs') {
    deferred.resolve(amdRefreshed);
    return deferred.promise;
  }
  
  // For dojo we need to add the dojo module in the list of modules for the build 
  if (amdOptions.loader === 'dojo')
    modulesAsString = '"dojo/dojo",' + modulesAsString;

  // Create the built loader file
  var boot = 'define([' + modulesAsString + '])';
  fs.writeFileSync(path.join(amdOptions.libraryPath, 'main.js'), boot);
  
  // Define the build config
  var buildConfig = {
    baseUrl: amdOptions.libraryPath,
    name: 'main',
    out: path.join(directory, 'assets/built.js'),
    locale: locale,
    optimize: 'none',
    inlineText: false,
    include: []
  };

  // For require js, we need to include the require module in the build via include
  if (amdOptions.loader === 'requirejs')
    buildConfig.include = ['../requirejs/require'];

  // Merge the user build config and the default build config and build
  requirejs.optimize(merge(amdOptions.buildConfig, buildConfig), function () {
    deferred.resolve(amdRefreshed);
  }, function (err) {
    deferred.reject(err);
  });

  return deferred.promise;
};

var walk = function walk(dir) {
  // Recursively walk thru a directory and returns the collection of files
  var results = [];
  var list = fs.readdirSync(dir);
  list.forEach(function (file) {
    file = path.join(dir, file);
    var stat = fs.statSync(file);
    if (stat && stat.isDirectory()) results = results.concat(walk(file));
    else results.push(file);
  });
  return results;
};

var getAMDModule = function getAMDModule(node, packages) {
  
  //We are only interested by the import declarations
  if (node.type !== 'ImportDeclaration')
    return null;

  // Should not happen but we never know
  if (!node.source || !node.source.value)
    return null; 

  // Should not happen but we never know
  var module = node.source.value;
  if (!module.length)
    return null;
  
  // Test if the module name starts with one of the AMD package names.
  // If so then it's an AMD module we can return it otherwise return null.
  var isAMD = packages.some(function (p) {
    return module.indexOf(p + '/') === 0;
  });

  return isAMD ? module : null;
};

var indexBuilder = function indexBuilder(config) {
  
  // Load the index file    
  var deferred = RSVP.defer();
  var indexPath = path.join(config.directory, config.indexFile);
  fs.readFile(indexPath, 'utf8', function (err, indexHtml) {
    if (err) {
      deferred.reject(err);
      return;
    }
    
    // Sha the index file and check if we need to rebuild the index file
    var newIndexSha = sha(indexHtml);
    config.refreshed = config.sha !== newIndexSha;

    // If the indx file is still the same then we can leave  
    if (!config.refreshed) {
      deferred.resolve(config);
      return;
    }
          
    // Get the collection of scripts 
    var $ = cheerio.load(indexHtml);
    var scriptElements = $('body > script');
    var scripts = [];
    scriptElements.filter(function () {
      return $(this).attr('src') !== undefined;
    }).each(function () {
      scripts.push("'" + $(this).attr('src') + "'");
    });
    config.scriptsAsString = scripts.join(',');
  
    // Remove the scripts tag
    scriptElements.remove();
  
    // Add to the body the amd loading code
    // First add the loader, we will use it as an anchor
    var loaderSrc = amdOptions.loader;
    if (loaderSrc === 'requirejs' || loaderSrc === 'dojo')
      loaderSrc = 'assets/built.js';

    $('body').prepend('<script src="' + loaderSrc + '"></script>');
    var loaderElement = $('body > script');
  
    // Then add the amd-config file if applicable
    if (typeof amdOptions.config === 'string')
      loaderElement.before('<script src="assets/amd-config.js"></script>');

    loaderElement.after('<script src="' + config.startSrc + '"></script>');    
  
    // Sha the new index
    var html = beautify_html($.html(), { indent_size: 2 });
    config.sha = sha(html);
  
    // Rewrite the index file
    fs.writeFileSync(indexPath, html);

    deferred.resolve(config);
  });

  return deferred.promise;
};

var startScriptBuilder = function startScriptBuilder(config) {
  // Write the amd-start.js file    
  // Build different arrays representing the modules for the injection in the start script
  var objs = modules.map(function (module, i) { return 'mod' + i; });
  var names = modules.map(function (module) { return "'" + module + "'"; });
  var adoptables = names.map(function (name, i) { return '{name:' + name + ',obj:' + objs[i] + '}'; });

  var namesAsString = names.join(',');
  var objsAsString = objs.join(',');
  var adoptablesAsString = adoptables.join(',');

  // Set the namesAsString in the return object. It's needed later on.
  config.namesAsString = namesAsString;

  // Create the object used by the template for the start script
  var amdConfig = JSON.stringify(typeof amdConfig === 'object' ? amdOptions.config : {});
  var startScript = startTemplate({
    config: amdConfig,
    names: namesAsString,
    objects: objsAsString,
    adoptables: adoptablesAsString,
    scripts: config.scriptsAsString,
    vendor: path.parse(outputPaths.vendor.js).name
  });
  
  fs.writeFileSync(path.join(config.directory, config.startSrc), beautify_js(startScript, { indent_size: 2 }));
};

module.exports = {

  name: 'ember-cli-amd',

  included: function (app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve
    
    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules usedby the application. 
    root = app.project.root;

    outputPaths = app.options.outputPaths;
    amdOptions = app.options.amd;

    // This addon relies on an 'amd' options in the ember-cli-build.js file
    if (!amdOptions) {
      console.log('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
      return;
    }

    // Merge the default options
    amdOptions = merge({
      loader: 'requirejs',
      packages: [],
      outputDependencyList: false,
      buildOuput: 'assets/built.js'
    }, amdOptions);
    
    // Determine the type of loader. We only support requirejs, dojo, or the path to a cdn
    if (!amdOptions.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }

    if ((amdOptions.loader === 'requirejs' || amdOptions.loader === 'dojo') && !amdOptions.libraryPath) {
      throw new Error('ember-cli-amd: When using a local loader, you must specify its location with the amdBase property in the amd options in ember-cli-build.js.');
    }
  },

  postprocessTree: function (type, tree) {

    if (type !== 'all')
      return tree;

    // Create the string replace patterns for the various application files
    // We will replace require and define function call by their pig-latin version
    var data = {
      files: [
        new RegExp(path.parse(outputPaths.app.js).name + '(.*js)'),
        new RegExp(path.parse(outputPaths.vendor.js).name + '(.*js)'),
        new RegExp(path.parse(outputPaths.tests.js).name + '(.*js)'),
        new RegExp(path.parse(outputPaths.testSupport.js.testSupport).name + '(.*js)')        
      ],
      patterns: [
        { match: /(\W|^|["])define(\W|["]|$)/g, replacement: '$1efineday$2' },
        { match: /(\W|^|["])require(\W|["]|$)/g, replacement: '$1equireray$2' }
      ]
    };
    var dataTree = stringReplace(tree, data);

    // Special case for the test loader that is doing some funky stuff with require
    var testLoader = {
      files: [
        new RegExp(path.parse(outputPaths.testSupport.js.testLoader).name + '(.*js)')
      ],
      patterns: [
        { match: /(\W|^|["])define(\W|["]|$)/g, replacement: '$1efineday$2' },
        { match: /[^.]require([(])/g, replacement: 'equireray(' }
      ]
    };
    
    return stringReplace(dataTree, testLoader);
  },

  postBuild: function (result) {
    // When ember build --watch or ember serve are used, this function will be called over and over 
    // as a user updates code. We need to figure what we have to build or copy.
  
    // If it is using a file for the amd configuration, we will just copy it. We don't need to 
    // use sha to define if we need to copy it or not, the price is equivalent.
    if (typeof amdOptions.config === 'string') {
      fs.createReadStream(path.join(root, amdOptions.config))
        .pipe(fs.createWriteStream(path.join(result.directory, 'assets/amd-config.js')));
    }
    
    // the amd builder is asynchronous. Ember-cli supports async addon functions. 
    return amdBuilder(result.directory).then(function (amdRefreshed) {
    
      // Rebuild the index files
      var indexPromise = indexBuilder({
        directory: result.directory,
        indexFile: outputPaths.app.html,
        sha: indexSha,
        startSrc: 'assets/amd-start.js'
      }).then(function (result) {
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString)
          scriptsAsString = result.scriptsAsString;
        else
          result.scriptsAsString = scriptsAsString;
        
        // Save the new sha
        indexSha = result.sha;
        
        // If nothing changed we can bail out
        if (!result.refreshed && !amdRefreshed)
          return;

        // The list of scripts has changed or the list of amd modules has changed, either way rebuld the
        // start script
        startScriptBuilder(result);

        // If requested, save the list of modules used
        if (!amdOptions.outputDependencyList)
          return;

        fs.writeFileSync(path.join(result.directory, 'dependencies.txt'), result.namesAsString);
      });

      var testIndexPromise = indexBuilder({
        directory: result.directory,
        indexFile: 'tests/index.html',
        sha: testIndexSha,
        startSrc: 'assets/amd-test-start.js'
      }).then(function (result) {
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString)
          testScriptsAsString = result.scriptsAsString;
        else
          result.scriptsAsString = testScriptsAsString;

        // Save the new sha
        testIndexSha = result.sha;
        
        // If nothing changed we can bail out
        if (!result.refreshed && !amdRefreshed)
          return;

        // The list of scripts has changed or the list of amd modules has changed, either way rebuld the
        // start script
        startScriptBuilder(result);
      }).catch(function () {
        // If there is no tests/index.html, the function will reject
        return;
      });

      return RSVP.all([indexPromise, testIndexPromise]);
    });
  }
};
