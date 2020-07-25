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

const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generator = require('@babel/generator').default;

// Replace indentifier
const Identifiers = {
  'require': 'eriuqer',
  'define': 'enifed'
};

// Use babel to parse/traverse/generate code.
// - replace define and require with enifed and eriuqer
// - if required, collect the external AMD modules referenced

module.exports = function replaceRequireAndDefine(code, amdPackages, externalAmdModules) {

  const ast = parse(code);

  traverse(ast, {
    Program(path) {
      // This will take care of the loader.js code where define and require are define globally
      // The cool thing is that babel will rename all references as well
      path.scope.rename('define', Identifiers.define);
      path.scope.rename('require', Identifiers.require);
    },
    CallExpression(path) {

      // Looking for:
      // - call for the global define function. If it matches then rename it and collect the external AMD references
      // - call for the global require function. It it matches then rename it
      // - eval calls: We need to process the eval code itself (used by auto-import)
      const { node } = path;

      // Looking for define('foo', ['a', 'b'], function(a, b) {})
      if (t.isIdentifier(node.callee, { name: 'define' })) {
        if (node.arguments.length < 2 || !t.isArrayExpression(node.arguments[1])) {
          return;
        }

        // Rename if it's invoking a global define function
        if (!path.scope.hasBinding('define')) {
          node.callee.name = Identifiers.define;
        }

        // Collect external AMD references
        if (!amdPackages || !externalAmdModules) {
          return;
        }

        node.arguments[1].elements.forEach(function(element) {
          if (!t.isStringLiteral(element)) {
            return;
          }

          const isExternalAmd = amdPackages.some(function(amdPackage) {
            return element.value.indexOf(amdPackage + '/') === 0 || element.value === amdPackage;
          });

          if (!isExternalAmd) {
            return;
          }

          externalAmdModules.add(element.value);

        });
        return;
      }

        // Rename if it's invoking a global require function
        if (t.isIdentifier(node.callee, { name: 'require' }) && !path.scope.hasBinding('require')) {
        node.callee.name = Identifiers.require;
      }

      // auto-import injects eval expression. We need to process them as individual code
      if (t.isIdentifier(node.callee, { name: 'eval' }) && t.isStringLiteral(node.arguments[0])) {
        node.arguments[0].value = replaceRequireAndDefine(node.arguments[0].value, amdPackages, externalAmdModules);
      }
    },
    VariableDeclarator(path) {
      // This could happened in auto-import eval: var d = define;
      if (t.isIdentifier(path.node.init, { name: 'define' }) && !path.scope.hasBinding('define')) {
        path.node.init.name = Identifiers.define;
        return;
      }
      // This could happened in auto-import eval: var r = require;
      if (t.isIdentifier(path.node.init, { name: 'require' }) && !path.scope.hasBinding('require')) {
        path.node.init.name = Identifiers.require;
      }
    },
    AssignmentExpression(path) {
      // This could happened in auto-import eval: window.d = define;
      if (t.isIdentifier(path.node.right, { name: 'define' }) && !path.scope.hasBinding('define')) {
        path.node.right.name = Identifiers.define;
        return;
      }
      // This could happened in auto-import eval: window.r = require;
      if (t.isIdentifier(path.node.right, { name: 'require' }) && !path.scope.hasBinding('require')) {
        path.node.right.name = Identifiers.require;
      }
    },

  });

  return generator(ast, {
    retainLines: true,
    retainFunctionParens: true
  }, code).code;
}
