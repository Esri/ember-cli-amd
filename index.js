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
var replace = require('broccoli-string-replace');
var esprima = require('esprima-harmony');
var eswalk = require('esprima-walk');
var replaceall = require('replaceall');
var strip = require('strip-comments');
var requirejs = require('requirejs');
var merge = require('merge');

/*
 * It is up the user to provide AMD package names
 * that will be loaded via an AMD loader:
 var app = new EmberApp({
  amdPackages: [
    'esri','dojo','dojox','dijit',
    'put-selector','xstyle','dbind','dgrid'
  ]
 });
*/

// application name should be used for .js file
var appName = '';
// set of AMD module names used in application
var modules = [];
// src for script tag, either CDN or public folder
var src;
// flag to determine how to do build when app reloads
var isBuilt = false;
// list of AMD packages to build
var amdPackages;
// String representation of all AMD files used in app
var names = '';
// root directory of application
var root = '';
// a root folder for AMD modules in bower_components - "bower_components/amdlibrary"
var amdBase;
// i18n locale
var locale;
// flag to determine if using RequireJS as loader
// requires that requirejs be installed via bower
var useRequire = false;
// flag to determine if addon should use Dojo loader
// requires that dojo be installed via bower
var useDojo = false;
// RequireJS Configuration
var requireConfig = {};

var findAMD = function findAMD() {
  var files = walk(root + '/app').filter(function(x) {
    return x.indexOf('.js') > -1;
  });
  var results = [];
  files.map(function(x) {
    var f = fs.readFileSync(x, 'utf8');
    var ast = esprima.parse(f);
    eswalk(ast, function(node) {
      var valid = isValid(node, amdPackages);
      if (valid) {
        results = results.concat(valid);
      }
    });
  });
  var unique = results.filter(function(elem, pos) {
    return results.indexOf(elem) == pos;
  }).sort();
  var tmp = unique.join("','");
  var _names_ = replaceall('"', "'",  JSON.stringify(tmp));
  return { names: _names_, modules: unique };
}

var amdBuilder = function amdBuilder(packageNames) {
  var boot = 'define([' + packageNames + '], function(){})';
  fs.writeFileSync(amdBase + '/main.js', boot);
  var cfg = {
    baseUrl: amdBase,
    name: 'main',
    out: amdBase + '/built.js',
    locale: locale,
    optimize: 'none',
    inlineText: false
  };

  if (!useDojo) {
    cfg.include = ['../requirejs/require'].concat(cfg.include);
  }

  if (requireConfig.include && requireConfig.include.length){
    cfg.include = cfg.include.concat(requireConfig.include);
  }

  // do not let user configs override these defaults
  delete requireConfig['baseUrl'];
  delete requireConfig['name'];
  delete requireConfig['out'];
  requirejs.optimize(merge(cfg, requireConfig), function(res) {});
};

var walk = function walk(dir) {
  var results = [];
  var list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    var stat = fs.statSync(file);
    if (stat && stat.isDirectory()) results = results.concat(walk(file));
    else results.push(file);
  });
  return results;
}

var validator = function validator(val, list) {
  if (val && val.length) {
    return list.filter(function(x) {
      return val.indexOf(x + '/') > -1;
    }).length > 0;
  } else {
    return false;
  }
};

var isValid = function isValid(node, packages) {
  // works with ES6 as used in ember-cli
  if (node.type === 'ImportDeclaration') {
    var val = '';
    if (node.source && node.source.value) {
      val = node.source.value;
    }
    if (validator(val, packages)) {
      return val;
    }
    return null;
  }
  return null;
};

var adoptFunction = "function adopt() {\n" +
  "      if (typeof adoptable !== 'undefined') {\n" +
  "        adopt = Function('');\n" +
  "        var len = adoptable.length;\n" +
  "        var i = 0;\n" +
  "        while (i < len--) {\n" +
  "          var adoptee = adoptable[len];\n" +
  "          if (adoptee !== undefined) {\n" +
  "            registry[adoptee.name] = new Module(adoptee.name, [], []);\n" +
  "            seen[adoptee.name] = adoptee.obj['default'] = adoptee.obj;\n" +
  "          }\n" +
  "        }\n" +
  "      }\n" +
  "    }\n";

var addAdopts = function addAdopts(f) {
  if (f.indexOf('adopt()') > 0) {
    return f;
  } else {
    var stripped = strip(f);

    var _f = stripped.replace(/\r?\n|\r/g, '^^^');
    var txt1 = 'requireModule = function(name) {';
    var idx1 = _f.indexOf(txt1);
    var _f1 = _f.slice(0, idx1 + txt1.length);
    var _f2 = _f.slice(idx1 + txt1.length, _f.length);
    var str = _f1 + '\r    adopt();\n' + _f2; // adding adopt();

    var txt2 = 'return (seen[name] = obj);^^^  };';
    var idx2 = str.indexOf(txt2); // found it, add adopt function here
    var f1 = str.slice(0, idx2 + txt2.length);
    var f2 = str.slice(idx2 + txt2.length, str.length);
    var f3 = f1 + '\r\r' + adoptFunction + f2;
    return replaceall('^^^', '\n', f3);
  }
};

var createContents = function createContents(names, objs, adoptables) {
  var contents = [
    '<script src="' + src + '"></script>\n',
    '<script>\n',
    (useRequire || useDojo ? 'require.config ? require.config(reqConfig) : require(reqConfig);\n' : ''),
    (names.length > 2 ? 'require([\n' + names : 'require([\n'),
    '], function(\n',
    objs.join(','),
    ') {\n',
    'adoptable = [',
    adoptables.join(''),
    '];\n',
    'var vendor=document.createElement("script");\n',
    'vendor.setAttribute("src", "assets/vendor.js");\n',
    'vendor.onload=function(){\n',
    'var app=document.createElement("script");\n',
    'app.setAttribute("src", "assets/', appName, '.js");\n',
    'document.body.appendChild(app);\n',
    '}\n',
    'document.body.appendChild(vendor);\n',
    '});\n',
    '</script>'
  ];
  return contents.join('');
};

var createContentsForTests = function createContentsForTests(names, objs, adoptables) {
  var contents = [
    '<script src="' + src + '"></script>\n',
    '<script>\n',
    (useRequire || useDojo ? 'require.config ? require.config(reqConfig) : require(reqConfig);\n' : ''),
    (names.length > 2 ? 'require([\n' + names : 'require([\n'),
    '], function(\n',
    objs.join(','),
    ') {\n',
    'adoptable = [',
    adoptables.join(''),
    '];\n',
    'var vendor=document.createElement("script");\n',
    'vendor.setAttribute("src", "assets/vendor.js");\n',
    'vendor.onload=function(){\n',
    'var testSupport=document.createElement("script");\n',
    'testSupport.setAttribute("src", "assets/test-support.js");\n',
    'testSupport.onload=function(){\n',
    'var app=document.createElement("script");\n',
    'app.setAttribute("src", "assets/', appName, '.js");\n',
    'document.body.appendChild(app);\n',
    'var testem=document.createElement("script");\n',
    'testem.setAttribute("src", "testem.js");\n',
    'document.body.appendChild(testem);\n',
    'var testLoader=document.createElement("script");\n',
    'testLoader.setAttribute("src", "assets/test-loader.js");\n',
    'document.body.appendChild(testLoader);\n',
    '}\n',
    'document.body.appendChild(testSupport);\n',
    '}\n',
    'document.body.appendChild(vendor);\n',
    '});\n',
    '</script>'
  ];
  return contents.join('');
};

module.exports = {
  name: 'ember-cli-amd',
  included: function(app) {
    root = app.project.root;
    amdBase = root + '/' + app.options.amdBase;
    appName = app.project.pkg.name;
    useRequire = !!app.options.useRequire;
    useDojo = !!app.options.useDojo;
    requireConfig = app.options.requireConfig || {};

    if (useRequire || useDojo) {
      src = 'assets/built.js';
    } else {
      src = app.options.srcTag;
    }

    if (!src) {
      throw new Error('You must specify a srcTag in options for ember-cli-amd addon.');
    }

    locale = app.options.locale || 'en-us';

    var ldr = fs.readFileSync(app.options.loader, 'utf8');
    if (ldr.indexOf('adopt()') < 0) {
      fs.writeFileSync(app.options.loader + '.original.js', ldr);
      var ldr_ = addAdopts(ldr);
      fs.writeFileSync(app.options.loader, ldr_);
    }
    amdPackages = amdPackages || app.options.amdPackages || [];
    var data = findAMD();
    var unique = data.modules;
    names = data.names;
    if (useDojo) {
      names = "'dojo/dojo'," + names;
    }
    if (useRequire || useDojo) {
      amdBuilder(names);
    }
    modules = unique;
  },
  postprocessTree: function(type, tree) {
    var data = {
      files: [
        new RegExp(appName + '(.*js)'),
        new RegExp('vendor(.*js)'),
        'assets/test-support.js'
      ],
      patterns: [
        { match: /(\W|^|["])define(\W|["]|$)/g, replacement: '$1efineday$2' },
        { match: /(\W|^|["])require(\W|["]|$)/g, replacement: '$1equireray$2' }
      ]
    };
    var testLoader = {
      files: [
        'assets/test-loader.js'
      ],
      patterns: [
        { match: /(\W|^|["])define(\W|["]|$)/g, replacement: '$1efineday$2' },
        { match: /[^.]require([(])/g, replacement: 'equireray(' }
      ]
    };
    var dataTree = replace(tree, data);
    return replace(dataTree, testLoader);
  },
  preBuild: function() {
    if (isBuilt) {
      var data = findAMD();
      if (data.names !== names) {
        names = data.names;
        if (useDojo) {
          names = "'dojo/dojo'," + names;
        }
        if (useRequire || useDojo) {
          amdBuilder(names);
        }
        isBuilt = true;
        modules = data.modules;
      }
    }
    isBuilt = true;
  },
  postBuild: function(result) {
    if (useRequire || useDojo) {
      // Writes a built JS file to the assets folder and reference it in the index.html
      var f = fs.readFileSync(amdBase + '/built.js', 'utf8');
      fs.writeFileSync(result.directory + '/assets/built.js', f);
    }
  },
  contentFor: function(type, config) {
    if (type === 'amd' || type === 'amd-test') {
      var _names = modules.join("','");
      var names = replaceall('"', "'",  JSON.stringify(_names));
      var objs = modules.map(function(val, i) {
        return 'mod' + i;
      });

      var len = modules.length;
      var idx = 0;
      var adoptables = [];
      for (idx; idx < len; idx++) {
        var o = '{name:'+JSON.stringify(modules[idx])+',obj:'+objs[idx]+'},';
        adoptables.push(o);
      }

      return (type === 'amd-test') ? createContentsForTests(names, objs, adoptables) : createContents(names, objs, adoptables);
    }
    return '';
  }
};
