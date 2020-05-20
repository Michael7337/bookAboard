define([
    'webix', './state-router', './app-state', './overview',
], function(webix, stateRouter, appState, overview) {
    return function(initialState, defaultState) {
      defaultState = defaultState || initialState;
      webix.ready(function() {
        stateRouter.addState(appState);
        stateRouter.addState(overview);
        stateRouter.on('routeNotFound', function(route, parameters) {
          stateRouter.go(defaultState, { route: route });
        });
        stateRouter.evaluateCurrentRoute(initialState);
      });
    };
});
