define([ 'webix', '$$', 'promise', './state-router'],
    function (webix, $$, promise, stateRouter) {
        return {
            name: 'app.login',
            route: '/login',
            template: {
                // webix ui definition here ...
                $ui: {
                    rows: [{
                        id: "log_form",
                        view: "form",
                        label: "login",
                        width: "100",
                        elements:[
                            { view:"text", label:"Email", name:"email"},
                            { view:"text", type:"password", label:"Password", name:"password"},
                            { margin:5, cols:[
                                    { view:"button", value:"Login" , css:"webix_primary",
                                        on:{
                                            onItemClick: function(){stateRouter.go("app.overview")}
                                        }},
                                    { view:"button", value:"Cancel"}
                                ]}
                        ]
                    }],
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
