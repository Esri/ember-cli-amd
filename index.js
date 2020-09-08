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

const ConvertToAMD = require('./lib/convert-to-amd-filter');

module.exports = {

  name: 'ember-cli-amd',

  externalAmdModules: new Set(),
  indexHtmlCache: {},

  included(app) {
    this._super.included.apply(this, arguments);
    
    // Note: this function is only called once even if using ember build --watch or ember serve

    // This is the entry point for this addon. We will collect the amd definitions from the ember-cli-build.js and
    // we will build the list off the amd modules used by the application, replace define and require function calls
    // in the js files and modify the index.html to load AMD loader first and all the external AMD modules before
    // loading the vendor and app files.

    // This addon relies on an 'amd' options in the ember-cli-build.js file and having a loader defined
    if (!app.options.amd || !app.options.amd.loader) {
      return;
    }

    // Merge the default options
    this.amdOptions = Object.assign({
      packages: [],
      excludePaths: [],
      loadingFilePath: 'assets'
    }, app.options.amd);
  },

  postprocessTree(type, tree) {
    if (!this.amdOptions) {
      return tree;
    }

    if (type !== 'all') {
      return tree;
    }

    // Note: this function will be called once during the continuous build. 
    // However, the tree returned will be directly manipulated by the continuous build.
    let options = {
      amdOptions: this.amdOptions,
      rootURL: this.app.project.config(this.app.env).rootURL
    }
    return new ConvertToAMD(tree, options);
  }
};
