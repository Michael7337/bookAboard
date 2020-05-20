/* global requirejs */
requirejs.config({
    baseUrl: 'static/lib',
    paths: {
        app: '../app',
        views: '../app/views',
        models: '../app/models',
        webix: '../js/webix_debug',
        promise: '../js/promise',
        $$: '../js/$$'
    },
    shim: {
        webix: {
          exports: 'webix'
        }
    }
});

requirejs([ '../../static/app/main']);