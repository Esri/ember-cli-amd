# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).

## [0.4.2]
### Added
- support for inlining of scripts
### Changed
- if not inlined, the amd-start and amd-config scripts are fingerprinted to enable cache-busting
- also ensured that other script tags in the body are not removed (i.e. google analytics)
- removed debugging cruft from `start-templates.txt`

## [0.4.1]
### Added
- support for assets deployed to cdn. If `fingerprint.prepend` is defined in the consuming project's `ember-cli-build.js` file, the specified path will be prepended to the AMD asset urls. If not present, the standard root-relative path of `/assets/SCRIPTNAME.js` is used.