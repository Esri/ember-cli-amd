'use strict';

const EmberAddon = require('ember-cli/lib/broccoli/ember-addon');

module.exports = function(defaults) {
  let app = new EmberAddon(defaults, {
    'ember-cli-babel': {
      sourceMaps: 'inline'
    },
    fingerprint: {
      enabled: true
    },
    amd: {
      loader: 'https://js.arcgis.com/3.28/',
      packages: [ // user defined AMD packages to search for in application
          'esri', 'dojo', 'dojox', 'dijit', 'put-selector', 'xstyle', 'dgrid'
      ],
      configPath: 'tests/dummy/config/dojo-config.js',
      inline: true
    }
  });

  /*
    This build file specifies the options for the dummy test app of this
    addon, located in `/tests/dummy`
    This build file does *not* influence how the addon or the app using it
    behave. You most likely want to be modifying `./index.js` or app's build file
  */

  return app.toTree();
};
