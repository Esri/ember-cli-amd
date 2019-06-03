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

/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const Funnel = require('broccoli-funnel');
const MergeTrees = require('broccoli-merge-trees');
const UnwatchedDir = require('broccoli-source').UnwatchedDir;

const ReplaceRequireAndDefinePlugin = require('./lib/replace-require-and-define-plugin');
const IndexHtmlWriterPlugin = require('./lib/index-html-writer-plugin');

const configScriptPath = '/assets/amd-config.js';

module.exports = {

  name: 'ember-cli-amd',

  amdModules: new Set(),

  included: function(app) {
    // Note: this functionis only called once even if using ember build --watch or ember serve

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
      if (!fs.existsSync(path.join(app.project.root, configPath))) {
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

    // Use the RequireFilter class to replace in the code that conflict with AMD loader
    const replaceRequireAndDefine = new ReplaceRequireAndDefinePlugin(
      new Funnel(tree, { exclude: ['**/*.html'] }),
      {
        amdPackages: this.app.options.amd.packages,
        amdModules: this.amdModules,
        excludePaths: this.app.options.amd.excludePaths
      }
    );

    let indexWriterTree = new Funnel(tree, { include: ['**/*.html'] });

    const configPath = this.app.options.amd.configPath;
    if (configPath) {
      const configPathDir = path.join(this.app.project.root, path.dirname(configPath));
      indexWriterTree = new MergeTrees([
        indexWriterTree,
        Funnel(new UnwatchedDir(configPathDir), {
          files: [path.basename(configPath)],
          getDestinationPath() {
            return configScriptPath;
          }
        })
      ]);
    }
    return new MergeTrees([
      replaceRequireAndDefine,
      new IndexHtmlWriterPlugin(
        [indexWriterTree],
        Object.assign({
          vendorPath: this.app.options.outputPaths.vendor.js,
          amdModules: this.amdModules
        },
        this.app.options.amd)
      )
    ]);
  }
};
