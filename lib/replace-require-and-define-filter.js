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

const Filter = require('broccoli-filter');
const replaceRequireAndDefine = require('./replace-require-and-define');

// Class for replacing in the generated code the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
module.exports = class ReplaceRequireAndDefineFilter extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);

    this.extensions = ['js'];
    this.targetExtension = 'js';

    this.description = options.description;
    this.amdPackages = options.amdPackages || [];
    this.externalAmdModules = options.externalAmdModules || new Set();
    this.excludePaths = options.excludePaths;
    // this.externalAmdModulesCache = new Set();
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

  processString(code, relativePath) {
    return replaceRequireAndDefine(code, this.amdPackages, this.externalAmdModules);
  }


  // processString(code, relativePath) {
  //   const externalAmdModulesForFile = new Set();
  //   const modifiedSource = replaceRequireAndDefine(code, this.amdPackages, externalAmdModulesForFile);
  //   this.externalAmdModulesCache = new Set([...this.externalAmdModulesCache, ...externalAmdModulesForFile]);
  //   return modifiedSource;
  // }

  // build() {
  //   this.externalAmdModules.clear();
  //   return super.build().then((value) => {
  //     for (const externalAmdModule of this.externalAmdModulesCache) {
  //       this.externalAmdModules.add(externalAmdModule);
  //     }
  //     return value;
  //   });
  // }
}