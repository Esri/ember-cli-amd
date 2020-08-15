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

const {
  parse
} = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generator = require('@babel/generator').default;

// Replace indentifier
const IdentifierMap = {
  'require': 'eriuqer',
  'define': 'enifed'
};

const Identifiers = Object.keys(IdentifierMap);


// Use babel to parse/traverse/generate code.
// - replace define and require with enifed and eriuqer
// - if required, collect the external AMD modules referenced

module.exports = function replaceRequireAndDefine(code, amdPackages, externalAmdModules) {

  const ast = parse(code);

  traverse(ast, {
    Program: {
      exit(path) {
        // This will take care of the loader.js code where define and require are define globally
        // The cool thing is that babel will rename all references as well
        // Rename at the end so we don't overlap with the CallExpression visitor
        Identifiers.forEach(identifier => path.scope.rename(identifier, IdentifierMap[identifier]));
      }
    },
    CallExpression(path) {

      // Looking for:
      // - call for the global define function. If it matches then rename it and collect the external AMD references
      // - call for the global require function. It it matches then rename it
      // - eval calls: We need to process the eval code itself (used by auto-import)
      const {
        node
      } = path;

      // Collect external AMD references
      // Looking for define('foo', ['a', 'b'], function(a, b) {})
      if (amdPackages &&
        externalAmdModules &&
        t.isIdentifier(node.callee, {
          name: 'define'
        }) &&
        node.arguments.length >= 2 &&
        t.isArrayExpression(node.arguments[1])) {

        node.arguments[1].elements.forEach(function (element) {
          if (!t.isStringLiteral(element)) {
            return;
          }

          const isExternalAmd = amdPackages.some(function (amdPackage) {
            return element.value.indexOf(amdPackage + '/') === 0 || element.value === amdPackage;
          });

          if (!isExternalAmd) {
            return;
          }

          externalAmdModules.add(element.value);

        });
      }

      // auto-import injects eval expression. We need to process them as individual code
      if (t.isIdentifier(node.callee, {
        name: 'eval'
      }) && t.isStringLiteral(node.arguments[0])) {
        node.arguments[0].value = replaceRequireAndDefine(node.arguments[0].value, amdPackages, externalAmdModules);
      }
    },
    Identifier(path) {
      // Only interested by our identifiers that have no bindings in the path scope
      if (!Identifiers.includes(path.node.name) || path.scope.hasBinding(path.node.name)) {
        return;
      }

      // Avoid: foo.define/require
      if (t.isMemberExpression(path.container) && path.container.property === path.node) {
        return;
      }

      // Avoid class properties/methods
      if ((t.isClassMethod(path.container) || t.isClassProperty(path.container)) && path.container.key === path.node) {
        return;
      }

      // Rename
      path.node.name = IdentifierMap[path.node.name];
    }

  });

  return generator(ast, {
    retainLines: true,
    retainFunctionParens: true
  }, code).code;
}
