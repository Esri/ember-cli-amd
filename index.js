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
var requirejs = require('requirejs');
var _ = require('lodash');
var merge = require('lodash/object/merge');
var template = require('lodash/string/template');
var beautify_js = require('js-beautify');
var beautify_html = require('js-beautify').html;
var RSVP = require('rsvp');

// The root of the project
var root;
// The set of AMD module names used in application. If this addon is used under
// continuous build (ember build --watch or ember serve), we need to verify that
// things have not changed in between two same function calls. We need variables
// to capture the sate
var modules = [];
var modulesAsString = '';
// The list of scripts from inside the index files
var scriptsAsString;
var testScriptsAsString;
// The sha of the re-built index files
var indexSha;
var testIndexSha;
// i18n locale
var locale;
// Template used to manufacture the start script
var startTemplate = template(fs.readFileSync(path.join(__dirname, 'start-template.txt'), 'utf8'));

var modulesToString = function modulesToString(modules) {
  return modules.map(function (module) { return '"' + module + '"'; }).join(',');
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
      buildOuput: 'assets/built.js'
    }, app.options.amd);
        
    // Determine the type of loader. We only support requirejs, dojo, or the path to a cdn
    if (!app.options.amd.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }

    if ((app.options.amd.loader === 'requirejs' || app.options.amd.loader === 'dojo') && !app.options.amd.libraryPath) {
      throw new Error('ember-cli-amd: When using a local loader, you must specify its location with the amdBase property in the amd options in ember-cli-build.js.');
    }
  },

  postprocessTree: function (type, tree) {
    if (!this.app.options.amd)
      return;

    if (type !== 'all')
      return tree;

    var outputPaths = this.app.options.outputPaths;
    
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
    if (!this.app.options.amd)
      return; 
      
    // When ember build --watch or ember serve are used, this function will be called over and over 
    // as a user updates code. We need to figure what we have to build or copy.
  
    // Copy the amd config file into the output.
    if (this.app.options.amd.configPath) {
      fs.createReadStream(path.join(root, this.app.options.amd.configPath))
        .pipe(fs.createWriteStream(path.join(result.directory, 'assets/amd-config.js')));
    }

    var baseUrl = '';
    if(this.app.options.fingerprint && this.app.options.fingerprint.prepend){
      baseUrl = this.app.options.fingerprint.prepend;
      console.info('ember-cli-amd: prepending  ' + baseUrl + ' for amd scripts.');
    }

    // the amd builder is asynchronous. Ember-cli supports async addon functions. 
    return this.amdBuilder(result.directory).then(function () {
    
      // Rebuild the index files
      var indexPromise = this.indexBuilder({
        directory: result.directory,
        indexFile: this.app.options.outputPaths.app.html,
        sha: indexSha,
        startSrc: 'assets/amd-start.js',
        baseUrl: baseUrl
      }).then(function (result) {
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString)
          scriptsAsString = result.scriptsAsString;
        else
          result.scriptsAsString = scriptsAsString;
        
        // Save the new sha
        indexSha = result.sha;

        // The list of scripts has changed or the list of amd modules has changed, either way rebuld the
        // start script
        this.startScriptBuilder(result);

        // If requested, save the list of modules used
        if (!this.app.options.amd.outputDependencyList)
          return;

        fs.writeFileSync(path.join(result.directory, 'dependencies.txt'), result.namesAsString);
      }.bind(this));

      var testIndexPromise = this.indexBuilder({
        directory: result.directory,
        indexFile: 'tests/index.html',
        sha: testIndexSha,
        startSrc: 'assets/amd-test-start.js',
        baseUrl: baseUrl
      }).then(function (result) {
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString)
          testScriptsAsString = result.scriptsAsString;
        else
          result.scriptsAsString = testScriptsAsString;

        // Save the new sha
        testIndexSha = result.sha;

        // The list of scripts has changed or the list of amd modules has changed, either way rebuld the
        // start script
        this.startScriptBuilder(result);
      }.bind(this)).catch(function () {
        // If there is no tests/index.html, the function will reject
        return;
      });

      return RSVP.all([indexPromise, testIndexPromise]);
    }.bind(this));
  },

  indexBuilder: function (config) {
    
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
      var amdScripts = '';
      if (this.app.options.amd.configPath){
        amdScripts += '<script src="' + config.baseUrl + 'assets/amd-config.js"></script>';
      }

      var loaderSrc = this.app.options.amd.loader;
      if (loaderSrc === 'requirejs' || loaderSrc === 'dojo'){
        loaderSrc = config.baseUrl + 'assets/built.js';
      }
      amdScripts += '<script src="' + loaderSrc + '"></script>';
      amdScripts += '<script src="' + config.baseUrl + config.startSrc + '"></script>';
      
      $('body').prepend(amdScripts);    
    
      // Sha the new index
      var html = beautify_html($.html(), { indent_size: 2 });
      config.sha = sha(html);
    
      // Rewrite the index file
      fs.writeFileSync(indexPath, html);

      deferred.resolve(config);
    }.bind(this));

    return deferred.promise;
  },

  startScriptBuilder: function (config) {
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
    var startScript = startTemplate({
      names: namesAsString,
      objects: objsAsString,
      adoptables: adoptablesAsString,
      scripts: config.scriptsAsString,
      vendor: path.parse(this.app.options.outputPaths.vendor.js).name
    });

    fs.writeFileSync(path.join(config.directory, config.startSrc), beautify_js(startScript, { indent_size: 2 }));
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
      var ast = esprima.parse(f, { sourceType: 'module' });
      
      // Walk thru the esprima nodes and collect the amd modules from the import statements 
      eswalk(ast, function (node) {
        var amdModule = getAMDModule(node, packages);
        if (!amdModule)
          return;
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
    if (this.app.options.amd.loader === 'dojo')
      modulesAsString = '"dojo/dojo",' + modulesAsString;
  
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
    if (this.app.options.amd.loader === 'requirejs')
      buildConfig.include = ['../requirejs/require'];
  
    // Merge the user build config and the default build config and build
    requirejs.optimize(merge(this.app.options.amd.buildConfig, buildConfig), function () {
      deferred.resolve();
    }, function (err) {
      deferred.reject(err);
    });

    return deferred.promise;
  }
};
