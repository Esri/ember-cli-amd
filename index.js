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
      outputDependencyList: true,
      inline:false,
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
      return tree;

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

  /**
   * Post-Build hook
   * @param  {object} result Inbound build information
   * @return {Promise}        Promise
   */
  postBuild: function (result) {
    if (!this.app.options.amd)
      return;

      console.info('POST BUILD CONFIG:', result);
      console.info('app.options.outputPaths:', this.app.options.outputPaths);
    // When ember build --watch or ember serve are used, this function will be called over and over
    // as a user updates code. We need to figure what we have to build or copy.

    //check if fingerprinting is setup, and if a prepend is set
    //and use that as a baseUrl for our scripts
    var baseUrl = '';
    if (this.app.options.fingerprint && this.app.options.fingerprint.enabled && this.app.options.fingerprint.prepend) {
      baseUrl = this.app.options.fingerprint.prepend;
    }

    // the amd builder is asynchronous. Ember-cli supports async addon functions.
    return this.amdBuilder(result.directory).then(function () {
      console.log('before main Index Builder...');
      // Rebuild the index files
      var indexPromise = this.indexBuilder({
        directory: result.directory,
        indexFile: this.app.options.outputPaths.app.html,
        sha: indexSha,
        startSrc: 'assets/amd-start.js',
        baseUrl: baseUrl
      }).then(function (result) {
        console.log('after main indexBuilder: result', result.scriptsAsString);
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString){
          scriptsAsString = result.scriptsAsString;
        }else{
          result.scriptsAsString = scriptsAsString;
        }
        // Save the new sha
        indexSha = result.sha;

        // If requested, save the list of modules used
        if (!this.app.options.amd.outputDependencyList)
          return;

        fs.writeFileSync(path.join(result.directory, 'dependencies.txt'), result.namesAsString);
      }.bind(this));
      console.log('before test Index Builder...');
      var testIndexPromise = this.indexBuilder({
        directory: result.directory,
        indexFile: 'tests/index.html',
        sha: testIndexSha,
        startSrc: 'assets/amd-test-start.js',
        inline: this.app.options.amd.inline,
        baseUrl: baseUrl
      }).then(function (result) {
        console.log('TEST result.scriptsAsString', result.scriptsAsString);
        // Save the script list if we got one otherwise reuse the saved one
        if (result.scriptsAsString){
          testScriptsAsString = result.scriptsAsString;
        }else{
          result.scriptsAsString = testScriptsAsString;
        }

        // Save the new sha
        testIndexSha = result.sha;

      }.bind(this)).catch(function () {
        // If there is no tests/index.html, the function will reject
        return;
      });

      return RSVP.all([indexPromise, testIndexPromise]);
      //return RSVP.all([indexPromise]);
    }.bind(this));
  },

  indexBuilder: function (config) {
    //----------------------------------------------------------------------------
    //STEPS:
    //1 - handle the configFile if defined
    //1 - get script names from index.html
    //2 - cook the amd-start script as a string
    //3 - if inline === true : inline the scripts
    //  - if inline === false : add script tags to the amd-start/amd-config files
    //----------------------------------------------------------------------------

    // Full path to the index file
    var indexPath = path.join(config.directory, config.indexFile);

    //1 - deal with the amd config file if defined
    var amdConfigInfo = this.handleAmdConfig(config);

    //2 - get the scripts from index.html
    return this.getScriptsFromIndex(indexPath)
      .then(function(scripts){
        console.log('In indexBuilder - after getScriptsFromIndex: ' + scripts);
        config.scriptsAsString = scripts;
        //3- create the start script
        var amdStartScriptInfo = this.startScriptBuilder(config);
        //assign the vars
        if(this.app.options.amd.inline){
          config.amdConfig = amdConfigInfo.amdConfig;
          config.amdStart = amdStartScriptInfo.amdStart;
        }else{
          config.amdConfigFileName = amdConfigInfo.amdConfigFileName;
          config.amdStartFileName = amdStartScriptInfo.amdStartFileName;
        }
        //update the index file
        return this.updateIndex(config);
      }.bind(this));

  },

  /**
   * If configured, read the amd config file into a string.
   * If we are not inlining scripts, compute the hash, and
   * write to a fingerprinted file
   * @param  {object} config Configuration object
   * @return {object}        amdConfig object
   */
  handleAmdConfig: function(config){
    var result = {
      amdConfig: null,
      amdConfigFileName:''
    };
    // If an amd config file is defined...
    if (this.app.options.amd.configPath) {
      //read the file contents and cook a sha for it
      result.amdConfig = fs.readFileSync(path.join(root, this.app.options.amd.configPath), 'utf8');
      //if we are not inlining...
      if(!this.app.options.amd.inline){
        //fingerprint it and copy it to the output
        var amdConfigSha = sha(result.amdConfig);
        result.amdConfigFileName = 'assets/amd-config-' + amdConfigSha + '.js';
        fs.writeFileSync(path.join(config.directory, result.amdConfigFileName), result.amdConfig);
      }
    }
    return result;
  },


  /**
   * Inline the amd-config and amd-start scripts
   * @param  {Object} config Configuration for this function
   * @return {Promise}        Promise
   */
  updateIndex: function(config){
    //var deferred = RSVP.defer();
    var indexPath = path.join(config.directory, config.indexFile);
    var indexHtml = fs.readFileSync(indexPath, 'utf8');

    // Sha the index file and check if we need to rebuild the index file
    var newIndexSha = sha(indexHtml);
    config.refreshed = config.sha !== newIndexSha;

    // If the indx file is still the same then we can leave
    if (!config.refreshed) {
      //deferred.resolve(config);
      return;
    }

    // Get the collection of scripts
    var $ = cheerio.load(indexHtml);
    var scriptElements = $('body > script');
    //remove them if they have src defined
    //this allows other scripts to be in the body with payloads
    scriptElements.filter(function () {
      return $(this).attr('src') !== undefined;
    }).remove();

    var loaderSrc = this.app.options.amd.loader;
    if (loaderSrc === 'requirejs' || loaderSrc === 'dojo'){
      loaderSrc = config.baseUrl + 'assets/built.js';
    }
    var amdScripts =  '<script src="' + loaderSrc + '"></script>';

    //if we are inlineing the scripts...
    if(this.app.options.amd.inline){
      //if the amdConfig has been passed in...
      if(config.amdConfig){
        amdScripts += '<script>' + config.amdConfig + '</script>';
      }
      amdScripts += '<script>' + config.amdStart + '</script>';
    }else{
      //or we are using external files - possibly from CDN etc
      if(config.amdConfigFileName){
        amdScripts += '<script src="' + config.baseUrl + config.amdConfigFileName + '"></script>';
      }
      amdScripts += '<script src="' + config.baseUrl + config.amdStartFileName + '"></script>';
    }
    //either case, update the doc
    $('body').prepend(amdScripts);
    // Sha the new index
    var html = $.html();
    config.sha = sha(html);
    // Rewrite the index file
    fs.writeFileSync(indexPath, html);
    console.log('End of updateIndex: ' , config.scriptsAsString);
    return config;
  },

  /**
   * Get a list of scripts from the Index file. This will
   * return the fingerprinted, prepended script urls which
   * we can then use in the creation of the AMD start script
   * @param  {string} indexFilePath Path to the index html file
   * @return {string}               Comma delimted string of scripts
   */
  getScriptsFromIndex: function(indexFilePath){
    var deferred = RSVP.defer();
    fs.readFile(indexFilePath, 'utf8', function (err, indexHtml) {
      if (err) {
        deferred.reject(err);
        return;
      }
      // Get the collection of scripts
      var $ = cheerio.load(indexHtml);
      //only pull scripts from the body. Allows head scripts to be left inplace
      //which is good for global libs loaded from cdns
      var scriptElements = $('body > script');
      var scripts = [];
      scriptElements.filter(function () {
        return $(this).attr('src') !== undefined;
      }).each(function () {
        scripts.push("'" + $(this).attr('src') + "'");
      });
      var scriptsAsString = scripts.join(',');
      console.info('GOT SCRIPTS FROM INDEX: ' + scriptsAsString);
      //return the string of script names
      deferred.resolve(scriptsAsString);

    }.bind(this));

    return deferred.promise;
  },

  /**
   * Build the start script that will load all the amd modules
   * and then, when vendor-*.js is loaded, register them with
   * Ember's loader
   * @param  {Object} config config object
   * @return {string}        Start Script as a string
   */
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

    var fileSha = sha(startScript);

    var hashedFileName = config.startSrc.split('.js')[0] + '-' +fileSha + '.js';

    //only write out the file if we are not inlining it
    if(!config.inline){
      fs.writeFileSync(path.join(config.directory, hashedFileName), beautify_js(startScript, { indent_size: 2 }));
    }

    var result = {
      amdStartFileName: hashedFileName,
      amdStart: startScript
    };

    return result;
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
