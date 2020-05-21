define([ 'webix', '$$', 'promise', './state-router'],
function (webix, $$, promise, stateRouter) {
  return {
    name: 'app.overview',
    route: '/overview',
    template: {
      // webix ui definition here ...
      $ui: {
        rows: [{
          view: "toolbar", id:"toolbar", elements:[
            {
              view: "icon", icon: "bars",
              click: function(){
                if( $$("menu").config.hidden){
                  $$("menu").show();
                }
                else
                  $$("menu").hide();
              }
            },
            {
              view: "label",
              label: "Demo"
            }
          ]
        }]
      },
      $oninit: function (view, scope) {
        webix.ui({
          id: "menu",
            view: "sidemenu",
            width: "200",
            height: "200",
            position: "left",
            body: {
          view: "list",
              borderless: true,
              scroll: false,
              template: "<span class='webix_icon fa-#icon#'></span> #value#",
              data:[
            {id: 1, value: "Customers", icon: "user"},
            {id: 2, value: "Products", icon: "cube"},
            {id: 3, value: "Reports", icon: "line-chart"},
            {id: 4, value: "Archives", icon: "database"},
            {id: 5, value: "Settings", icon: "cog"}
          ]
        }
        })
      }
    },
    resolve: function(data, parameters, cb) {
      cb();
  	},
    activate: function(context) {
    }
  };
});
