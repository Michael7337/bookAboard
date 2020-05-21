define([
    'webix', './state-router', './app-state', './overview', './login',
], function(webix, stateRouter, appState, overview, login) {
    return function(initialState, defaultState) {
      defaultState = defaultState || initialState;
      webix.ready(function() {
        stateRouter.addState(appState);
        stateRouter.addState(overview);
        stateRouter.addState(login);
        stateRouter.on('routeNotFound', function(route, parameters) {
          stateRouter.go(defaultState, { route: route });
        });
        stateRouter.evaluateCurrentRoute(initialState);
      });
    };
});
