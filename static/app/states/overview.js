define([ 'webix', '$$', 'promise', './state-router'],
function (webix, $$, promise, stateRouter) {
  return {
    name: 'app.overview',
    route: '/overview',
    template: {
      // webix ui definition here ...
      $ui: {
        rows: [{
          id: "hello",
          view: "text",
          label: "Hello"
        },{
          view:"treetable",
          columns:[
            { id:"id", header:"", width:50},
            { id:"value", header:"Film title", width:250,
             template:"{common.treetable()} #value#" },
            { id:"chapter", header:"Mode", width:200}
          ],
          data: [
            { "id":"1", "value":"The Shawshank Redemption", "open":true, "data":[
              { "id":"1.1", "value":"Part 1", "chapter":"alpha"},
              { "id":"1.2", "value":"Part 2", "chapter":"beta", "open":true, "data":[
                { "id":"1.2.1", "value":"Part 1", "chapter":"beta-twin"}
              ]}
            ]}
          ]
        }]
      },
      $oninit: function (view, scope) {
      }
    },
    resolve: function(data, parameters, cb) {
      cb();
  	},
    activate: function(context) {
    }
  };
});
