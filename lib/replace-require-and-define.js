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

const esprima = require('esprima');
const eswalk = require('esprima-walk');

// Identifiers and Literals to replace in the code to avoid conflict with amd loader
const identifiers = {
  'require': 'eriuqer',
  'define': 'enifed'
};

const literals = {
  'require': '\'eriuqer\'',
  '(require)': '\'(eriuqer)\''
};

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
module.exports = function replaceRequireAndDefine(code, amdPackages, amdModules) {
  // Parse the code as an AST
  const ast = esprima.parseScript(code, {
    range: true
  });

  // Split the code into an array for easier substitutions
  const buffer = code.split('');

  // Walk thru the tree, find and replace our targets
  eswalk(ast, function (node) {
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

          node.arguments[1].elements.forEach(function (element) {
            if (element.type !== 'Literal') {
              return;
            }

            const isAMD = amdPackages.some(function (amdPackage) {
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
