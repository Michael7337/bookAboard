define([
    './state-router', './overview',
], function(stateRouter, overview) {
    return {
        name: 'app',
        route: '/app',
        template: {
            $ui: {
                rows: [
                    { $subview: true }
                ]
            },
            $oninit: function() {  }
        }
    };
});
