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
"use strict";

const fs = require("fs");
const path = require("path");
const Filter = require("broccoli-filter");
const cheerio = require("cheerio");
const beautify_js = require("js-beautify");
const beautify_html = require("js-beautify").html;
const _ = require("lodash");

const replaceRequireAndDefine = require("./replace-require-and-define");

const amdLoadingTemplate = _.template(
  fs.readFileSync(path.join(__dirname, "amd-loading.txt"), "utf8")
);
const indexFiles = ["index.html", "tests/index.html"];

// Class for replacing, in the generated code, the AMD protected keyword 'require' and 'define'.
// We are replacing these keywords by non conflicting words.
// It uses the broccoli filter to go thru the different files (as string).
module.exports = class ConvertToAMD extends Filter {
  constructor(inputTree, options = {}) {
    super(inputTree, {});

    this.extensions = ["js", "html"];

    // Options for the process
    this.loader = options.amdOptions.loader;
    this.amdPackages = options.amdOptions.packages || [];
    this.excludePaths = options.amdOptions.excludePaths;
    this.loadingFilePath = (
      options.amdOptions.loadingFilePath || "assets"
    ).replace(/\/$/, "");
    this.rootURL = options.rootURL || "";
    this.inline = !!options.amdOptions.inline;

    // Because the filter is call for partial rebuild during 'ember serve', we need to
    // know what was added/removed for a partial build
    this.externalAmdModules = new Set();
    this.externalAmdModulesCache = new Map();

    // There are two index files that should be converted:
    // - index.html
    // - tests/index.html
    // We need to keep things separated as they don't load the same script set.
    this.indexHtmlCaches = {
      "index.html": {
        scriptsToLoad: [],
        loadingScript: this.loadingFilePath + "/amd-loading.js",
        afterLoadingScript: this.loadingFilePath + "/after-amd-loading.js",
      },
      "tests/index.html": {
        scriptsToLoad: [],
        loadingScript: this.loadingFilePath + "/amd-loading-tests.js",
        afterLoadingScript:
          this.loadingFilePath + "/after-amd-loading-tests.js",
      },
    };
  }

  getDestFilePath(relativePath) {
    relativePath = super.getDestFilePath(relativePath);
    if (!relativePath) {
      return null;
    }

    if (relativePath.indexOf("index.html") >= 0) {
      return relativePath;
    }

    for (let i = 0, len = this.excludePaths.length; i < len; i++) {
      if (relativePath.indexOf(this.excludePaths[i]) === 0) {
        return null;
      }
    }

    if (relativePath.indexOf(".js") >= 0) {
      return relativePath;
    }

    return null;
  }

  processString(code, relativePath) {
    if (relativePath.indexOf(".js") >= 0) {
      return this._processJsFile(code, relativePath);
    }

    return this._processIndexFile(code, relativePath);
  }

  _processIndexFile(code, relativePath) {
    const cheerioQuery = cheerio.load(code);

    // Get the collection of scripts
    // Scripts that have a 'src' will be loaded by AMD
    // Scripts that have a body will be assembled into a post loading file and loaded at the end of the AMD loading process
    const scriptElements = cheerioQuery("body > script");
    const scriptsToLoad = [];
    const inlineScripts = [];
    scriptElements.each(function () {
      if (cheerioQuery(this).attr("src")) {
        scriptsToLoad.push(`"${cheerioQuery(this).attr("src")}"`);
      } else {
        inlineScripts.push(cheerioQuery(this).html());
      }
    });

    this.indexHtmlCaches[relativePath].scriptsToLoad = scriptsToLoad;

    // If we have inline scripts, we will save them into a script file and load it as part of the amd loading
    this.indexHtmlCaches[relativePath].afterLoadingCode = undefined;
    if (inlineScripts.length > 0) {
      this.indexHtmlCaches[relativePath].afterLoadingCode = beautify_js(
        replaceRequireAndDefine(inlineScripts.join("\n\n")),
        {
          indent_size: 2,
          max_preserve_newlines: 1,
        }
      );
      scriptsToLoad.push(
        `"${this.rootURL}${this.indexHtmlCaches[relativePath].afterLoadingScript}"`
      );
    }

    // Replace the original ember scripts by the amd ones
    scriptElements.remove();

    // Beautify the index.html
    return beautify_html(cheerioQuery.html(), {
      indent_size: 2,
      max_preserve_newlines: 0,
    });
  }

  _processJsFile(code, relativePath) {
    const externalAmdModulesForFile = new Set();
    const modifiedSource = replaceRequireAndDefine(
      code,
      this.amdPackages,
      externalAmdModulesForFile,
      relativePath.includes("vendor.js")
    );

    // Bookkeeping of what has changed for this file compared to previous builds
    if (externalAmdModulesForFile.size === 0) {
      // No more AMD references
      this.externalAmdModulesCache.delete(relativePath);
    } else {
      // Replace with the new set
      this.externalAmdModulesCache.set(relativePath, externalAmdModulesForFile);
    }

    return modifiedSource;
  }

  _buildModuleInfos() {
    // Build different arrays representing the modules for the injection in the start script
    const objs = [];
    const names = [];
    const adoptables = [];
    let index = 0;
    this.externalAmdModules.forEach((externalAmdModule) => {
      objs.push(`mod${index}`);
      names.push(`'${externalAmdModule}'`);
      adoptables.push(`{name:'${externalAmdModule}',obj:mod${index}}`);
      index++;
    });

    return {
      names: names.join(","),
      objects: objs.join(","),
      adoptables: adoptables.join(","),
    };
  }

  async build() {
    // Clear before each build since the filter is kept by ember-cli during 'ember serve'
    // and being reused without going thru postProcessTree. If we don't clean we may get
    // previous modules.
    this.externalAmdModules.clear();

    const result = await super.build();

    // Re-assemble the external AMD modules set with the updated cache
    this.externalAmdModulesCache.forEach((externalAmdModules) => {
      externalAmdModules.forEach((externalAmdModule) => {
        this.externalAmdModules.add(externalAmdModule);
      });
    });

    // Write the various script files we need
    const moduleInfos = this._buildModuleInfos();
    indexFiles.forEach((indexFile) => {
      const indexPath = path.join(this.outputPath, indexFile);
      if (!fs.existsSync(indexPath)) {
        // When building for production, tests/index.html will not exist, so we can skip its loading scripts
        return;
      }

      // We add scripts to each index.html file to kick off the loading of amd modules.
      const cheerioQuery = cheerio.load(fs.readFileSync(indexPath));
      const amdScripts = [
        `<script src="${this.loader}" data-amd=true></script>`,
      ];
      const scripts = this.indexHtmlCaches[indexFile].scriptsToLoad.join(",");
      const loadingScript = beautify_js(
        amdLoadingTemplate(_.assign(moduleInfos, { scripts })),
        {
          indent_size: 2,
          max_preserve_newlines: 1,
        }
      );

      if (this.inline) {
        // Inline the amd-loading script directly in index.html
        amdScripts.push(`<script>${loadingScript}</script>`);
      } else {
        // Add a script tag to index.html to load the amd-loading script, and write the script to the output directory
        amdScripts.push(
          `<script src="${this.rootURL}${this.indexHtmlCaches[indexFile].loadingScript}" data-amd-loading=true></script>`
        );
        fs.writeFileSync(
          path.join(
            this.outputPath,
            this.indexHtmlCaches[indexFile].loadingScript
          ),
          loadingScript
        );
      }

      // After loading script
      if (this.indexHtmlCaches[indexFile].afterLoadingCode) {
        fs.writeFileSync(
          path.join(
            this.outputPath,
            this.indexHtmlCaches[indexFile].afterLoadingScript
          ),
          this.indexHtmlCaches[indexFile].afterLoadingCode
        );
      }

      // Remove from body previous script tags (case for ember serve).
      cheerioQuery("body > script").remove();

      // Write the new script tags
      cheerioQuery("body").prepend(amdScripts.join("\n"));
      const html = beautify_html(cheerioQuery.html(), {
        indentSize: 2,
        max_preserve_newlines: 0,
      });
      fs.writeFileSync(indexPath, html);
    });

    return result;
  }
};
