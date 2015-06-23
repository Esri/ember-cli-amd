# Ember-cli-amd

This addon will dynamically modify `loader.js` to allow it to work in parallel with a separate AMD loader.
*Thanks to [Jack Rowlingson](https://github.com/jrowlingson) for figuring out how to use an AMD loader and ember-cli loader concurrently.*

[View it live](http://arcgis.github.io/ember-cli-amd/) using the [ArcGIS API for JavaScript](https://developers.arcgis.com/javascript/).

## Features
* Load AMD modules in parallel with [ember-cli/loader.js](https://github.com/ember-cli/loader.js).
* Works with AMD CDN libraries, such as [Dojo](https://dojotoolkit.org/download/) or the [ArcGIS API for JavaScript](https://developers.arcgis.com/javascript/).
* Uses the [RequireJS Optimizer](http://requirejs.org/docs/optimization.html) for fast buids while coding.

## Installation

* `git clone` this repository
* `npm install`
* `bower install`

## Usage

Install to your ember-cli application

* `npm install --save ember-cli-amd`

Provide a list of packages that will be loaded via an AMD loader such as RequireJS or Dojo. You can also provide the source for the loader.
```javascript
// use this in Brocfile.js
// Sample if using the ArcGIS API for JavaScript
var app = new EmberApp({
  srcTag: 'https://js.arcgis.com/3.13/', // only needed for CDN, will default to 'built.js' if useRequire = true
  useRequire: false, // if this is true, srcTag via options is ignored
  useDojo: false // if this is true, will inject the Dojo loader instead of RequireJS
  locale: 'en-us', // will use RequireJS i18n to set the localization
  amdPackages: [ // user defined AMD packages to search for in application
    'esri','dojo','dojox','dijit',
    'put-selector','xstyle','dgrid'
  ],
  amdBase: 'bower_components/amdlibrary', // optional - base folder of AMD library
  // RequireJS configuration options
  // Please refere to RequireJS docs for more information
  // http://requirejs.org/docs/optimization.html
  requireConfig: {
    include: [
      'foo/bar/baz'
    ],
    exclude: [
      'lorem/ipsum'
    ],
    paths: {
      'plugins/plugin': 'empty:'
    }
  }
});
```

Update the `index.html` file to allow this addon to add script files as needed.
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>EsrijsApp</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">

    {{content-for 'head'}}

    <link rel="stylesheet" href="http://js.arcgis.com/3.13/esri/css/esri.css">

    {{content-for 'head-footer'}}
  </head>
  <body>
    <!-- This script tag must come before the content-for "amd" block -->
    <script>
      // Please refere to RequireJS configuration options
      // http://requirejs.org/docs/api.html#config
      // If using Dojo, this configuration will be treated like dojoConfig.
      // Please refer to Dojo documentation for details
      // http://dojotoolkit.org/documentation/tutorials/1.10/dojo_config/
      var reqConfig = {};
    </script>

    {{content-for 'amd'}}

    {{content-for 'body'}}

    {{content-for 'body-footer'}}
  </body>
</html>
```

Update this `ENV` object in `config/environment.js` to allow pulling in CDN resources such as with the ArcGIS API for JavaScript.
```javascript
var ENV = {
  ...
  contentSecurityPolicy: {
    'default-src': "'none'",
    'script-src': "'self' 'unsafe-eval' 'unsafe-inline' http://js.arcgis.com/ https://js.arcgis.com/",
    'font-src': "'self'",
    'connect-src': "'self' http://services.arcgis.com/ http://services.arcgisonline.com/",
    'img-src': "'self' http://js.arcgis.com/",
    'style-src': "'self' 'unsafe-inline'",
    'media-src': "'self'"
  }
```

# Running

* `ember server`
* Visit your app at http://localhost:4200.

## Running Tests

* `ember test`
* `ember test --server`

## Building

* `ember build`

## Requirements
* [ember-cli](http://www.ember-cli.com/) 0.2.3 or greater.

## Resources
* For more information on using ember-cli, visit [http://www.ember-cli.com/](http://www.ember-cli.com/).
* To learn more about the ArcGIS API for JavaScript, visit [the developers pages](https://developers.arcgis.com/javascript/).

## Issues

Find a bug or want to request a new feature?  Please let us know by submitting an issue.

## Contributing

Esri welcomes contributions from anyone and everyone. Please see our [guidelines for contributing](https://github.com/esri/contributing).

[](Esri Tags: ember-cli-amd)
[](Esri Language: JavaScript)​
