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
const Funnel = require('broccoli-funnel');
const Plugin = require('broccoli-plugin');
const MergeTrees = require('broccoli-merge-trees');
const UnwatchedDir = require('broccoli-source').UnwatchedDir;
const esprima = require('esprima');
const eswalk = require('esprima-walk');
const walkSync = require('walk-sync');
const mkdirp = require('mkdirp');
const _ = require('lodash');
const beautify_js = require('js-beautify');
const beautify_html = require('js-beautify').html;

// The root of the project
let root;

const configScriptPath = '/assets/amd-config.js';
const amdStartScriptPath = '/assets/amd-start.js';

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
    root = app.project.root;

    if (!app.options.amd) {
      return new Error('ember-cli-amd: No amd options specified in the ember-cli-build.js file.');
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

  postprocessTree: function(type, tree) {
    // Note: this function will be called once during the continuous builds. However, the tree returned will be directly manipulated.
    // It means that the de-requireing will be going on.
    if (type !== 'all') {
      return tree;
    }

    const configPath = this.app.options.amd.configPath;
    
    if (configPath) {
      const configPathDir = path.join(root, path.dirname(configPath));
      const amdConfig = Funnel(new UnwatchedDir(configPathDir), {
        files: [path.basename(configPath)],
        getDestinationPath() {
          return configScriptPath;
        }
      })
    }

    // Use the RequireFilter class to replace in the code that conflict with AMD loader
    return new MergeTrees([
      new ReplaceRequireAndDefine(
        new Funnel(tree, { exclude: ['**/*.html'] }),
        {
          amdPackages: this.app.options.amd.packages,
          amdModules: this.amdModules,
          excludePaths: this.app.options.amd.excludePaths
        }
      ),
      new IndexWriter(
        [MergeTrees([new Funnel(tree, { include: ['**/*.html'] })])],
        Object.assign({
          vendorPath: this.app.options.outputPaths.vendor.js,
          amdModules: this.amdModules
        },
        this.app.options.amd)
      )
    ]);
  }
};

// Class for replacing in the generated code the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
class ReplaceRequireAndDefine extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);

    this.extensions = ['js'];
    this.targetExtension = 'js';

    this.description = options.description;
    this.amdPackages = options.amdPackages || [];
    this.amdModules = options.amdModules;
    this.excludePaths = options.excludePaths;
  }

  getDestFilePath(relativePath) {
    relativePath = super.getDestFilePath(relativePath);
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

class IndexWriter extends Plugin {
  constructor(inputNodes, options) {
    super(inputNodes, options);

    this.amdModules = options.amdModules;
    this.writeScriptsInline = options.inline;
    this.configPath = options.configPath;
    this.loaderPath = options.loader;
    this.vendorPath = options.vendorPath;
    this.indexCache = {};
  }

  build() {
    const srcDir = this.inputPaths[0];
    
    const paths = walkSync(srcDir, { directories: false });

    paths.forEach((relativePath) => {
      if (path.extname(relativePath) !== '.html') {
        return;
      }
      const indexHtml = fs.readFileSync(path.join(srcDir, relativePath), 'utf8');
      this.writeIndex(indexHtml, relativePath);
    });
  }

  writeIndex(indexHtml, relativePath) {
    // Check if we have to continue
    // - If there are no scripts with the data-amd attribute then something rewrote index html and will need to rewrite the index file
    const cheerioQuery = cheerio.load(indexHtml);
    const amdScriptElements = cheerioQuery('script[data-amd]');
    if (amdScriptElements.length === 0) {
      this.indexCache[relativePath] = {};
    }

    // If no change in the module was detected then no need to rewrite the index file
    const modulesToLoad = Array.from(this.amdModules).join(','); 
    if (this.indexCache[relativePath].modules === modulesToLoad) {
      return;
    }
    this.indexCache[relativePath].modules = modulesToLoad;
    amdScriptElements.remove();

    let amdScripts = '';

    // TODO: ONLY LOAD FILE ONCE
    if (this.configPath) {
      const configScript = fs.readFileSync(path.join(this.inputPaths[0], configScriptPath), 'utf8');

      if (this.writeScriptsInline) {
        amdScripts += `<script data-amd="true">${configScript}</script>`;
      } else {
        amdScripts += `<script src="${configScriptPath}" data-amd="true"></script>`;
        this.writeFile(configScriptPath, beautify_js(configScript, { indent_size: 2 }));
      }
    }

    // Add the loader
    amdScripts += `<script src="${this.loaderPath}" data-amd="true"></script>`;



    // Get the collection of scripts
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process


    const otherScriptElements = cheerioQuery('body > script');
    var scriptsToLoad = [];
    //var scriptsToPostExecute = [];
    otherScriptElements.each(function() {
      if (cheerioQuery(this).attr('src')) {
        scriptsToLoad.push(`"${cheerioQuery(this).attr('src')}"`);
      } else {
        //scriptsToPostExecute.push(cheerioQuery(this).html());
      }
    });

    // Remove the script tags
    otherScriptElements.remove();
  
    let startScript;
    if (scriptsToLoad === 0) {
      startScript = this.indexCache[relativePath].startScript;
    } else {
      startScript = startTemplate(Object.assign(this.buildModuleInfos(), {
        scripts: scriptsToLoad.join(',')
      }));
    }
    this.indexCache[relativePath].startScript = startScript;

    // TODO: Deal with inline scripts
    // // If we have scripts that have to be executed after the AMD load, then serialize them into a file
    // // afterLoading.js and add this file to the list of AMD modules.
    // if (scriptsToPostExecute.length > 0) {
    //   var afterLoadingScript = replaceRequireAndDefine(scriptsToPostExecute.join('\n\n'));
    //   fs.writeFileSync(path.join(config.directory, 'afterLoading.js'), beautify_js(afterLoadingScript, {
    //     indent_size: 2
    //   }));
    //   scriptsToLoad.push('"/afterLoading.js"');
    // }

    // 
    if (this.writeScriptsInline) {
      amdScripts += `<script data-amd="true">${startScript}</script>`;
    } else {
      amdScripts += `<script src="${amdStartScriptPath}" data-amd="true"></script>`;
      this.writeFile(amdStartScriptPath, beautify_js(startScript, { indent_size: 2 }));
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
      vendor: path.parse(this.vendorPath).name
    };
  }

  writeFile(relativePath, data) {
    try {
      fs.writeFileSync(path.join(this.outputPath, relativePath), data);
    } catch(err) {
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
