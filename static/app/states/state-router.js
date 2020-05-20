define([
    'webix', '../../js/webix-state-renderer', '../../js/abstract-state-router'
], function (webix, webixStateRenderer, abstractStateRouter) {
    let renderer = webixStateRenderer(webix);
    return abstractStateRouter(renderer, this.document.body);
});
