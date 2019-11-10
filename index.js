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

const ReplaceRequireAndDefineFilter = require('./lib/replace-require-and-define-filter');
const convertIndexToAmd = require('./lib/convert-index-to-amd');

module.exports = {

  name: 'ember-cli-amd',

  externalAmdModules: new Set(),

  included(app) {
    // Note: this function is only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules used by the application, replace define and require function calls
    // in the js files and modify the index.html to load AMD loader first and all the external AMD modules before
    // loading the vendor and app files.

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

  postprocessTree(type, tree) {
    // Note: this function will be called once during the continuous builds. However, the tree returned will be directly manipulated.
    // It means that the de-requireing will be going on.
    if (type !== 'all' || !this.app.options.amd) {
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

  postBuild(result) {

    // When ember build --watch or ember serve are used, this function will be called over and over
    // as a user updates code.

    // We can only rebbuild the index after ALL the cli addons have ran. 
    // We cannot bbuild it during the postPrecessTree!
    convertIndexToAmd(this.app, result.directory, this.externalAmdModules);
  }
};
