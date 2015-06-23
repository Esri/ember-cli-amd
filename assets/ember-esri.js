/* jshint ignore:start */

/* jshint ignore:end */

efineday('ember-esri/app', ['exports', 'ember', 'ember/resolver', 'ember/load-initializers', 'ember-esri/config/environment'], function (exports, Ember, Resolver, loadInitializers, config) {

  'use strict';

  var App;

  Ember['default'].MODEL_FACTORY_INJECTIONS = true;

  App = Ember['default'].Application.extend({
    modulePrefix: config['default'].modulePrefix,
    podModulePrefix: config['default'].podModulePrefix,
    Resolver: Resolver['default']
  });

  loadInitializers['default'](App, config['default'].modulePrefix);

  exports['default'] = App;

});
efineday('ember-esri/components/esri-legend', ['exports', 'ember', 'esri/dijit/Legend'], function (exports, Ember, Legend) {

  'use strict';

  exports['default'] = Ember['default'].Component.extend({

    classNames: ['legendDiv'],
    willRemoveElement: function willRemoveElement() {
      var legend = this.get('legend');
      if (legend) {
        legend.destroy();
      }
    },
    onMapChange: (function () {
      var legend = this.get('legend');
      var map = this.get('map');
      if (map && legend) {
        legend.set('map', map);
        legend.refresh();
      }
      if (map && !legend) {
        legend = new Legend['default']({
          map: map
        }, this.elementId);
        this.set('legend', legend);
        legend.startup();
      }
    }).observes('map')

  });

});
efineday('ember-esri/components/esri-map', ['exports', 'ember', 'esri/arcgis/utils', 'esri/layers/FeatureLayer', 'esri/tasks/query'], function (exports, Ember, arcgisUtils, FeatureLayer, Query) {

  'use strict';

  exports['default'] = Ember['default'].Component.extend({

    classNames: ['viewDiv'],

    didInsertElement: function didInsertElement() {
      var _this = this;

      this.set('mapid', '010f412d4d0a4e8f9ff09ead37963ac7');
      var url = 'http://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Freeway_System/FeatureServer/1';
      arcgisUtils['default'].createMap(this.get('mapid'), this.elementId).then(function (response) {
        _this.set('map', response.map);
        var fLayer = new FeatureLayer['default'](url);
        _this.get('map').addLayers([fLayer]);
        var q = new Query['default']();
        q.where = 'ROUTE_NUM = \'I10\'';
        return fLayer.selectFeatures(q);
      });
    },

    willRemoveElement: function willRemoveElement() {
      var map = this.get('map');
      if (map) {
        map.destroy();
      }
    },

    onSwitchMap: (function () {
      var _this2 = this;

      var mapid = this.get('mapid');
      var map = this.get('map');
      if (map) {
        map.destroy();
        arcgisUtils['default'].createMap(mapid, this.elementId).then(function (response) {
          _this2.set('map', response.map);
        });
      }
    }).observes('mapid')

  });

});
efineday('ember-esri/components/esri-search', ['exports', 'ember', 'esri/dijit/Search'], function (exports, Ember, Search) {

  'use strict';

  exports['default'] = Ember['default'].Component.extend({

    willRemoveElement: function willRemoveElement() {
      var search = this.get('search');
      if (search) {
        search.destroy();
      }
    },

    onMapChange: (function () {
      var search = this.get('search');
      var map = this.get('map');
      if (map && search) {
        search.set('map', map);
      }
      if (map && !search) {
        search = new Search['default']({
          map: this.get('map')
        }, this.elementId);
        this.set('search', search);
      }
    }).observes('map')

  });

});
efineday('ember-esri/components/map-switch', ['exports', 'ember'], function (exports, Ember) {

  'use strict';

  var mapid1 = 'b64bdd175e124a5e8226a9efc8a048c0';
  var mapid2 = '010f412d4d0a4e8f9ff09ead37963ac7';

  exports['default'] = Ember['default'].Component.extend({

    classNames: ['btn btn-primary'],

    tagName: 'button',

    click: function click() {
      var mapid = this.get('mapid');
      if (mapid === mapid1) {
        this.set('mapid', mapid2);
      } else {
        this.set('mapid', mapid1);
      }
    }

  });

});
efineday('ember-esri/controllers/array', ['exports', 'ember'], function (exports, Ember) {

	'use strict';

	exports['default'] = Ember['default'].Controller;

});
efineday('ember-esri/controllers/object', ['exports', 'ember'], function (exports, Ember) {

	'use strict';

	exports['default'] = Ember['default'].Controller;

});
efineday('ember-esri/initializers/app-version', ['exports', 'ember-esri/config/environment', 'ember'], function (exports, config, Ember) {

  'use strict';

  var classify = Ember['default'].String.classify;
  var registered = false;

  exports['default'] = {
    name: 'App Version',
    initialize: function initialize(container, application) {
      if (!registered) {
        var appName = classify(application.toString());
        Ember['default'].libraries.register(appName, config['default'].APP.version);
        registered = true;
      }
    }
  };

});
efineday('ember-esri/initializers/export-application-global', ['exports', 'ember', 'ember-esri/config/environment'], function (exports, Ember, config) {

  'use strict';

  exports.initialize = initialize;

  function initialize(container, application) {
    var classifiedName = Ember['default'].String.classify(config['default'].modulePrefix);

    if (config['default'].exportApplicationGlobal && !window[classifiedName]) {
      window[classifiedName] = application;
    }
  }

  ;

  exports['default'] = {
    name: 'export-application-global',

    initialize: initialize
  };

});
efineday('ember-esri/router', ['exports', 'ember', 'ember-esri/config/environment'], function (exports, Ember, config) {

  'use strict';

  var Router = Ember['default'].Router.extend({
    location: config['default'].locationType
  });

  Router.map(function () {});

  exports['default'] = Router;

});
efineday('ember-esri/templates/application', ['exports'], function (exports) {

  'use strict';

  exports['default'] = Ember.HTMLBars.template((function() {
    return {
      isHTMLBars: true,
      revision: "Ember@1.12.0",
      blockParams: 0,
      cachedFragment: null,
      hasRendered: false,
      build: function build(dom) {
        var el0 = dom.createDocumentFragment();
        var el1 = dom.createElement("div");
        dom.setAttribute(el1,"class","app-container");
        var el2 = dom.createTextNode("\n  ");
        dom.appendChild(el1, el2);
        var el2 = dom.createComment("");
        dom.appendChild(el1, el2);
        var el2 = dom.createTextNode("\n");
        dom.appendChild(el1, el2);
        dom.appendChild(el0, el1);
        var el1 = dom.createTextNode("\n");
        dom.appendChild(el0, el1);
        return el0;
      },
      render: function render(context, env, contextualElement) {
        var dom = env.dom;
        var hooks = env.hooks, content = hooks.content;
        dom.detectNamespace(contextualElement);
        var fragment;
        if (env.useFragmentCache && dom.canClone) {
          if (this.cachedFragment === null) {
            fragment = this.build(dom);
            if (this.hasRendered) {
              this.cachedFragment = fragment;
            } else {
              this.hasRendered = true;
            }
          }
          if (this.cachedFragment) {
            fragment = dom.cloneNode(this.cachedFragment, true);
          }
        } else {
          fragment = this.build(dom);
        }
        var morph0 = dom.createMorphAt(dom.childAt(fragment, [0]),1,1);
        content(env, morph0, context, "outlet");
        return fragment;
      }
    };
  }()));

});
efineday('ember-esri/templates/index', ['exports'], function (exports) {

  'use strict';

  exports['default'] = Ember.HTMLBars.template((function() {
    var child0 = (function() {
      return {
        isHTMLBars: true,
        revision: "Ember@1.12.0",
        blockParams: 0,
        cachedFragment: null,
        hasRendered: false,
        build: function build(dom) {
          var el0 = dom.createDocumentFragment();
          var el1 = dom.createTextNode("  ");
          dom.appendChild(el0, el1);
          var el1 = dom.createComment("");
          dom.appendChild(el0, el1);
          var el1 = dom.createTextNode("\n");
          dom.appendChild(el0, el1);
          return el0;
        },
        render: function render(context, env, contextualElement) {
          var dom = env.dom;
          var hooks = env.hooks, get = hooks.get, inline = hooks.inline;
          dom.detectNamespace(contextualElement);
          var fragment;
          if (env.useFragmentCache && dom.canClone) {
            if (this.cachedFragment === null) {
              fragment = this.build(dom);
              if (this.hasRendered) {
                this.cachedFragment = fragment;
              } else {
                this.hasRendered = true;
              }
            }
            if (this.cachedFragment) {
              fragment = dom.cloneNode(this.cachedFragment, true);
            }
          } else {
            fragment = this.build(dom);
          }
          var morph0 = dom.createMorphAt(fragment,1,1,contextualElement);
          inline(env, morph0, context, "esri-search", [], {"map": get(env, context, "map")});
          return fragment;
        }
      };
    }());
    var child1 = (function() {
      return {
        isHTMLBars: true,
        revision: "Ember@1.12.0",
        blockParams: 0,
        cachedFragment: null,
        hasRendered: false,
        build: function build(dom) {
          var el0 = dom.createDocumentFragment();
          var el1 = dom.createTextNode("  Toggle Map\n");
          dom.appendChild(el0, el1);
          return el0;
        },
        render: function render(context, env, contextualElement) {
          var dom = env.dom;
          dom.detectNamespace(contextualElement);
          var fragment;
          if (env.useFragmentCache && dom.canClone) {
            if (this.cachedFragment === null) {
              fragment = this.build(dom);
              if (this.hasRendered) {
                this.cachedFragment = fragment;
              } else {
                this.hasRendered = true;
              }
            }
            if (this.cachedFragment) {
              fragment = dom.cloneNode(this.cachedFragment, true);
            }
          } else {
            fragment = this.build(dom);
          }
          return fragment;
        }
      };
    }());
    return {
      isHTMLBars: true,
      revision: "Ember@1.12.0",
      blockParams: 0,
      cachedFragment: null,
      hasRendered: false,
      build: function build(dom) {
        var el0 = dom.createDocumentFragment();
        var el1 = dom.createComment("");
        dom.appendChild(el0, el1);
        var el1 = dom.createTextNode("\n");
        dom.appendChild(el0, el1);
        var el1 = dom.createComment("");
        dom.appendChild(el0, el1);
        var el1 = dom.createComment("");
        dom.appendChild(el0, el1);
        return el0;
      },
      render: function render(context, env, contextualElement) {
        var dom = env.dom;
        var hooks = env.hooks, get = hooks.get, inline = hooks.inline, block = hooks.block;
        dom.detectNamespace(contextualElement);
        var fragment;
        if (env.useFragmentCache && dom.canClone) {
          if (this.cachedFragment === null) {
            fragment = this.build(dom);
            if (this.hasRendered) {
              this.cachedFragment = fragment;
            } else {
              this.hasRendered = true;
            }
          }
          if (this.cachedFragment) {
            fragment = dom.cloneNode(this.cachedFragment, true);
          }
        } else {
          fragment = this.build(dom);
        }
        var morph0 = dom.createMorphAt(fragment,0,0,contextualElement);
        var morph1 = dom.createMorphAt(fragment,2,2,contextualElement);
        var morph2 = dom.createMorphAt(fragment,3,3,contextualElement);
        dom.insertBoundary(fragment, null);
        dom.insertBoundary(fragment, 0);
        inline(env, morph0, context, "esri-legend", [], {"map": get(env, context, "map")});
        block(env, morph1, context, "esri-map", [], {"map": get(env, context, "map"), "mapid": get(env, context, "mapid")}, child0, null);
        block(env, morph2, context, "map-switch", [], {"map": get(env, context, "map"), "mapid": get(env, context, "mapid")}, child1, null);
        return fragment;
      }
    };
  }()));

});
efineday('ember-esri/tests/app.jshint', function () {

  'use strict';

  module('JSHint - .');
  test('app.js should pass jshint', function() { 
    ok(true, 'app.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/components/esri-legend.jshint', function () {

  'use strict';

  module('JSHint - components');
  test('components/esri-legend.js should pass jshint', function() { 
    ok(true, 'components/esri-legend.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/components/esri-map.jshint', function () {

  'use strict';

  module('JSHint - components');
  test('components/esri-map.js should pass jshint', function() { 
    ok(true, 'components/esri-map.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/components/esri-search.jshint', function () {

  'use strict';

  module('JSHint - components');
  test('components/esri-search.js should pass jshint', function() { 
    ok(true, 'components/esri-search.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/components/map-switch.jshint', function () {

  'use strict';

  module('JSHint - components');
  test('components/map-switch.js should pass jshint', function() { 
    ok(true, 'components/map-switch.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/helpers/resolver', ['exports', 'ember/resolver', 'ember-esri/config/environment'], function (exports, Resolver, config) {

  'use strict';

  var resolver = Resolver['default'].create();

  resolver.namespace = {
    modulePrefix: config['default'].modulePrefix,
    podModulePrefix: config['default'].podModulePrefix
  };

  exports['default'] = resolver;

});
efineday('ember-esri/tests/helpers/resolver.jshint', function () {

  'use strict';

  module('JSHint - helpers');
  test('helpers/resolver.js should pass jshint', function() { 
    ok(true, 'helpers/resolver.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/helpers/start-app', ['exports', 'ember', 'ember-esri/app', 'ember-esri/router', 'ember-esri/config/environment'], function (exports, Ember, Application, Router, config) {

  'use strict';



  exports['default'] = startApp;
  function startApp(attrs) {
    var application;

    var attributes = Ember['default'].merge({}, config['default'].APP);
    attributes = Ember['default'].merge(attributes, attrs); // use defaults, but you can override;

    Ember['default'].run(function () {
      application = Application['default'].create(attributes);
      application.setupForTesting();
      application.injectTestHelpers();
    });

    return application;
  }

});
efineday('ember-esri/tests/helpers/start-app.jshint', function () {

  'use strict';

  module('JSHint - helpers');
  test('helpers/start-app.js should pass jshint', function() { 
    ok(true, 'helpers/start-app.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/router.jshint', function () {

  'use strict';

  module('JSHint - .');
  test('router.js should pass jshint', function() { 
    ok(true, 'router.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/test-helper', ['ember-esri/tests/helpers/resolver', 'ember-qunit'], function (resolver, ember_qunit) {

	'use strict';

	ember_qunit.setResolver(resolver['default']);

});
efineday('ember-esri/tests/test-helper.jshint', function () {

  'use strict';

  module('JSHint - .');
  test('test-helper.js should pass jshint', function() { 
    ok(true, 'test-helper.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/unit/components/esri-legend-test', ['ember-qunit'], function (ember_qunit) {

  'use strict';

  ember_qunit.moduleForComponent('esri-legend', 'Unit | Component | esri legend', {
    // Specify the other units that are required for this test
    // needs: ['component:foo', 'helper:bar'],
    unit: true
  });

  ember_qunit.test('it renders', function (assert) {
    assert.expect(2);

    // Creates the component instance
    var component = this.subject();
    assert.equal(component._state, 'preRender');

    // Renders the component to the page
    this.render();
    assert.equal(component._state, 'inDOM');
  });

});
efineday('ember-esri/tests/unit/components/esri-legend-test.jshint', function () {

  'use strict';

  module('JSHint - unit/components');
  test('unit/components/esri-legend-test.js should pass jshint', function() { 
    ok(true, 'unit/components/esri-legend-test.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/unit/components/esri-map-test', ['ember-qunit'], function (ember_qunit) {

  'use strict';

  ember_qunit.moduleForComponent('esri-map', 'Unit | Component | esri map', {
    // Specify the other units that are required for this test
    // needs: ['component:foo', 'helper:bar'],
    unit: true
  });

  ember_qunit.test('it renders', function (assert) {
    assert.expect(2);

    // Creates the component instance
    var component = this.subject();
    assert.equal(component._state, 'preRender');

    // Renders the component to the page
    this.render();
    assert.equal(component._state, 'inDOM');
  });

});
efineday('ember-esri/tests/unit/components/esri-map-test.jshint', function () {

  'use strict';

  module('JSHint - unit/components');
  test('unit/components/esri-map-test.js should pass jshint', function() { 
    ok(true, 'unit/components/esri-map-test.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/unit/components/esri-search-test', ['ember-qunit'], function (ember_qunit) {

  'use strict';

  ember_qunit.moduleForComponent('esri-search', 'Unit | Component | esri search', {
    // Specify the other units that are required for this test
    // needs: ['component:foo', 'helper:bar'],
    unit: true
  });

  ember_qunit.test('it renders', function (assert) {
    assert.expect(2);

    // Creates the component instance
    var component = this.subject();
    assert.equal(component._state, 'preRender');

    // Renders the component to the page
    this.render();
    assert.equal(component._state, 'inDOM');
  });

});
efineday('ember-esri/tests/unit/components/esri-search-test.jshint', function () {

  'use strict';

  module('JSHint - unit/components');
  test('unit/components/esri-search-test.js should pass jshint', function() { 
    ok(true, 'unit/components/esri-search-test.js should pass jshint.'); 
  });

});
efineday('ember-esri/tests/unit/components/map-switch-test', ['ember-qunit'], function (ember_qunit) {

  'use strict';

  ember_qunit.moduleForComponent('map-switch', 'Unit | Component | map switch', {
    // Specify the other units that are required for this test
    // needs: ['component:foo', 'helper:bar'],
    unit: true
  });

  ember_qunit.test('it renders', function (assert) {
    assert.expect(2);

    // Creates the component instance
    var component = this.subject();
    assert.equal(component._state, 'preRender');

    // Renders the component to the page
    this.render();
    assert.equal(component._state, 'inDOM');
  });

});
efineday('ember-esri/tests/unit/components/map-switch-test.jshint', function () {

  'use strict';

  module('JSHint - unit/components');
  test('unit/components/map-switch-test.js should pass jshint', function() { 
    ok(true, 'unit/components/map-switch-test.js should pass jshint.'); 
  });

});
/* jshint ignore:start */

/* jshint ignore:end */

/* jshint ignore:start */

efineday('ember-esri/config/environment', ['ember'], function(Ember) {
  var prefix = 'ember-esri';
/* jshint ignore:start */

try {
  var metaName = prefix + '/config/environment';
  var rawConfig = Ember['default'].$('meta[name="' + metaName + '"]').attr('content');
  var config = JSON.parse(unescape(rawConfig));

  return { 'default': config };
}
catch(err) {
  throw new Error('Could not read config from meta tag with name "' + metaName + '".');
}

/* jshint ignore:end */

});

if (runningTests) {
  equireray("ember-esri/tests/test-helper");
} else {
  equireray("ember-esri/app")["default"].create({"name":"ember-esri","version":"0.0.0.5a9a1ab2"});
}

/* jshint ignore:end */
//# sourceMappingURL=ember-esri.map