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
const Filter = require('broccoli-filter');
const espree = require('espree');
const eswalk = require('esprima-walk');
const _ = require('lodash');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
var SilentError = require('silent-error');

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

  included: function(app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules usedby the application.
    root = app.project.root;

    // This addon relies on an 'amd' options in the ember-cli-build.js file
    if (!app.options.amd) {
      return new SilentError('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
    }

    // Merge the default options
    app.options.amd = _.merge({ packages: [], excludePaths: [] }, app.options.amd);

    // Determine the type of loader.
    if (!app.options.amd.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }
  },

  postprocessTree: function(type, tree) {
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
      amdModules: this.amdModules,
      excludePaths: this.app.options.amd.excludePaths
    });
  },

  postBuild: function(result) {

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

  indexBuilder: function(config) {
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
    scriptElements.each(function() {
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

  buildModuleInfos: function() {

    // Build different arrays representing the modules for the injection in the start script
    const objs = [];
    const names = [];
    const adoptables = [];
    let index = 0;
    this.amdModules.forEach(function(amdModule) {
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
  this.excludePaths = options.excludePaths;
}

RequireFilter.prototype = Object.create(Filter.prototype);
RequireFilter.prototype.constructor = RequireFilter;

RequireFilter.prototype.extensions = ['js'];
RequireFilter.prototype.targetExtension = 'js';

RequireFilter.prototype.getDestFilePath = function(relativePath) {
  relativePath = Filter.prototype.getDestFilePath.call(this, relativePath);
  if (!relativePath) {
    return relativePath;
  }
  for (var i = 0, len = this.excludePaths.length; i < len; i++) {
    if (relativePath.indexOf(this.excludePaths[i]) === 0) {
      return null;
    }
  }
  return relativePath;
}
RequireFilter.prototype.processString = function(code) {
  return replaceRequireAndDefine(code, this.amdPackages, this.amdModules);
};

// Write the new string into the range provided without modifying the size of arr.
// If the size of arr changes, then ranges from the parsed code would be invalidated.
// Since str.length can be shorter or longer than the range it is overwriting,
// write str into the first position of the range and then fill the remainder of the
// range with undefined.
// 
// We know that a range will only be written to once.
// And since the array is used for positioning and then joined, this method of overwriting works.
function write(arr, str, range) {
  const offset = range[0];
  arr[offset] = str;
  for (let i = offset + 1; i < range[1]; i++) {
    arr[i] = undefined;
  }
}

// Use Esprima to parse the code and eswalk to walk thru the code
// Replace require and define by non-conflicting verbs
function replaceRequireAndDefine(code, amdPackages, amdModules) {
  // Parse the code as an AST
  const ast = espree.parse(code, {
    range: true,
    ecmaVersion: 9,
    sourceType: 'script',
  });

  // Split the code into an array for easier substitutions
  const buffer = code.split('');

  // Walk thru the tree, find and replace our targets
  eswalk(ast, function(node) {
    if (!node) {
      return;
    }

    switch (node.type) {
      case 'CallExpression':

        if (!amdPackages || !amdModules) {
          // If not provided then we don't need to track them
          break;
        }

        // Collect the AMD modules
        // Looking for something like define(<name>, [<module1>, <module2>, ...], <function>)
        // This is the way ember defines a module
        if (node.callee.name === 'define') {

          if (node.arguments.length < 2 || node.arguments[1].type !== 'ArrayExpression' || !node.arguments[1].elements) {
            return;
          }

          node.arguments[1].elements.forEach(function(element) {
            if (element.type !== 'Literal') {
              return;
            }

            const isAMD = amdPackages.some(function(amdPackage) {
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
        }

        // Dealing with ember-auto-import eval
        if (node.callee.name === 'eval' && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') {
          const evalCode = node.arguments[0].value;
          const evalCodeAfter = replaceRequireAndDefine(evalCode, amdPackages, amdModules);
          if (evalCode !== evalCodeAfter) {
            write(buffer, "eval(" + JSON.stringify(evalCodeAfter) + ");", node.range);
          }
        }

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

          write(buffer, identifier, node.range);
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

          write(buffer, literal, node.range);
        }
        return;
    }
  });

  // Return the new code
  return buffer.join('');
}