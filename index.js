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

const UnwatchedDir = require('broccoli-source').UnwatchedDir;
const merge = require('broccoli-merge-trees');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const Filter = require('broccoli-filter');
const funnel = require('broccoli-funnel');
const esprima = require('esprima');
const eswalk = require('esprima-walk');
const _ = require('lodash');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;
var SilentError = require('silent-error');

// The root of the project
let root;

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

const configScriptPath = 'assets/amd-config';
const defineModulesScriptPath = 'assets/define-amd-modules';

module.exports = {

  name: 'ember-cli-amd',

  amdModules: new Set(),

  included: function(app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve
    root = app.project.root;

    if (!app.options.amd) {
      return new SilentError('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
    }

    app.options.amd = Object.assign({
      packages: [],
      excludePaths: [],
      inline: true
    }, app.options.amd);

    if (!app.options.amd.loader) {
      throw new Error('ember-cli-amd: You must specify a loader option the amd options in ember-cli-build.js.');
    }


    if (app.options.amd.configPath) {
      const configPath = app.options.amd.configPath;
      if (!fs.existsSync(path.join(root, configPath))) {
        throw new Error(`ember-cli-amd: The file specified in the configPath option "${configPath}" does not exist`);
      }
    }
  },

  contentFor: function(type, config) {
    const rootURL = config.rootURL;
    if (type === 'body') {
      // This adds the amd-config & loader script to the various index.html files
      return `<script src="${rootURL}${configScriptPath}.js"></script>` +
        `<script src="${this.app.options.amd.loader}" data-amd="true"></script>`;
    }

    if (type === 'amd-mdoules') {
      // This adds the amd modules definition to the index.html files
        return `<script src="${rootURL}${defineModulesScriptPath}.js"></script>`;
    }
  },

  treeForPublic: function() {
    if (this.app.options.amd.configPath && !this.app.options.amd.inline) {
      // If not inlined, this is responsible for adding the amd config script asset to the build
      const configPath = this.app.options.amd.configPath;
      let configPathDir = path.join(root, path.dirname(configPath));
      
      const destConfigFile = `${configScriptPath}.js`;
      const amdConfig = funnel(new UnwatchedDir(configPathDir), {
        files: [path.basename(configPath)],
        getDestinationPath() {
          return destConfigFile;
        }
      });
      return amdConfig;
    }
  },

  postprocessTree: function(type, tree) {
    if (!this.app.options.amd) {
      return tree;
    }

    if (type !== 'all') {
      return tree;
    }

    // Use the ReplaceRequireAndDefineFilter class to replace in the code that conflict with AMD loader
    const postProcessTrees = [new ReplaceRequireAndDefineFilter(tree, {
      amdPackages: this.app.options.amd.packages,
      amdModules: this.amdModules,
      excludePaths: this.app.options.amd.excludePaths
    })];

    if (!this.app.options.amd.inline) {
      // If not inlined, this class is responsible for adding the amd modules definition script to the build
      postProcessTrees.push(new DefineAmdModulesFileWriter(
        funnel(new UnwatchedDir(root), {
          files: ['start-template.txt']
        }), {
          amdModules: this.amdModules
        }
      ));
    }
    return merge(postProcessTrees);
  },

  preBuild: function() {
    // Clear AMD Modules so that postprocess start with an empty set
    this.amdModules.clear();
  },

  postBuild: function(result) {
    if (!this.app.options.amd) {
      return;
    }

    // Get the modules information
    const moduleInfos = buildModuleInfos(this.amdModules);

    // There are two index files to deal with, the app index file and the test index file.
    // We need to convert them from ember style to amd style.
    // Amd style is made of 3 steps:
    // - amd configuration (optional), controlled by the this.app.options.amd.configPath
    // - loader: could be based on local build or from cdn
    // - amd module definition: define the amd modules in the ember loader used by the app
    this.indexBuilder({
      directory: result.directory,
      indexFile: this.app.options.outputPaths.app.html,
      moduleInfos
    });

    // Rebuild the test index file
    this.indexBuilder({
      directory: result.directory,
      indexFile: 'tests/index.html',
      moduleInfos
    });
  },

  indexBuilder: function(config) {
    // Modify the index file to replace any inline ember loader require and defines
    // Also, modify the amd config and amd module definition scripts depending on necessity and inline options
    const indexPath = path.join(config.directory, config.indexFile);

    let indexHtml;
    try {
      indexHtml = fs.readFileSync(indexPath, 'utf8');
    } catch (e) {
      // no index file, we are done.
      return null;
    }

    const cheerioQuery = cheerio.load(indexHtml);

    // Add the script that will be responsible for loading the amd-modules, added in {{content-for "post-vendor"}}
    const defineAmdModulesScriptElement = cheerioQuery(`script[src^="${defineModulesScriptPath}"]`);
  
    if (config.moduleInfos.names.trim() === '') {
      // No modules to load, remove the define amd modules script
      defineAmdModulesScriptElement.remove();
    } else if (this.app.options.amd.inline) {
      // Inline the define amd modules script
      defineAmdModulesScriptElement.html(startTemplate(config.moduleInfos));
      defineAmdModulesScriptElement.attr('src', null);
    }

    
    // Add the script that will be responsible for setting the amd configuration 
    const amdConfigScriptElement = cheerioQuery(`script[src^="${configScriptPath}"]`);
    if (!this.app.options.amd.configPath) {
      // No config, remove the amd config script
      amdConfigScriptElement.remove();
    } else if (this.app.options.amd.inline) {
      // Inline the amd config script
      const amdConfigScriptContent = fs.readFileSync(path.join(root, this.app.options.amd.configPath), 'utf8');
      amdConfigScriptElement.html(amdConfigScriptContent);
      amdConfigScriptElement.attr('src', null);
    }

    // TODO: TEST THIS
    // // Any inline scripts the use the ember loader require or define need to be updated
    // var scriptElements = cheerioQuery('script[src="assets/load-amd-modules.js"]');
    // scriptElements.each(function(i ,elem) {
    //   const scriptElement = cheerioQuery(this);
    //   scriptElement.html(replaceRequireAndDefine(scriptElement.html()));
    // });

    // Rewrite the index file
    fs.writeFileSync(indexPath, beautify_html(cheerioQuery.html(), { indent_size: 2 }));
  }
};

function buildModuleInfos(modules) {
  const objs = [];
  const names = [];
  const adoptables = [];

  let index = 0;
  modules.forEach(function(amdModule) {
    objs.push(`mod${index}`);
    names.push(`'${amdModule}'`);
    adoptables.push(`{name:'${amdModule}',obj:mod${index}}`);
    index++;
  });

  return {
    names: names.join(','),
    objects: objs.join(','),
    adoptables: adoptables.join(',')
  };
}


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
  const ast = esprima.parseScript(code, {
    range: true
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

// Class for replacing in the generated code the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
class ReplaceRequireAndDefineFilter extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);

    this.extensions = ['js'];
    this.targetExtension = 'js';

    options = options || {};

    this.description = options.description;
    this.amdPackages = options.amdPackages || [];
    this.amdModules = options.amdModules;
    this.excludePaths = options.excludePaths;
  }

  getDestFilePath(relativePath) {
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

  processString(code) {
    return replaceRequireAndDefine(code, this.amdPackages, this.amdModules);
  }
}

// Class for 
class DefineAmdModulesFileWriter extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);

    options = options || {};

    this.amdModules = options.amdModules;
  }

  getDestFilePath(relativePath) {
    relativePath = Filter.prototype.getDestFilePath.call(this, relativePath);
    if (!relativePath) {
      return relativePath;
    }
    if (relativePath === 'start-template.txt') {
      return `${defineModulesScriptPath}.js`;
    }
    return null;
  }

  processString() {
    return beautify_js(
      startTemplate(buildModuleInfos(this.amdModules)),
      { indentSize: 2 }
    );
  }
}