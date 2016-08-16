# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

## [0.4.8]
- Don't replace #define with #efineday
- Add support for package main shorthand in module names
- Fix type for `buildOutput` and update README.

## [0.4.7]
### Fix
- Fix regular expression check for "require" in test loader

## [0.4.6]
### Fix
- Fix esprima parsing issue for functions with parameters with a default value

## [0.4.5]
### Changed
- Only scripts with src !== undefined are removed from the body. This allows us to put Google Analytics in the page or other json payloads

## [0.4.4]
### Added
- support for inlining of scripts
### Changed
- if not inlined, the amd-start and amd-config scripts are fingerprinted to enable cache-busting
- also ensured that other script tags in the body are not removed (i.e. google analytics)

## [0.4.1]
### Added
- support for assets deployed to cdn. If `fingerprint.prepend` is defined in the consuming project's `ember-cli-build.js` file, the specified path will be prepended to the AMD asset urls. If not present, the standard root-relative path of `/assets/SCRIPTNAME.js` is used.
