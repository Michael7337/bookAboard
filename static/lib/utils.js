define([
  'common/$$', 'common/promise', 'common/utils', 'common/lodash.get', 'common/lodash.set'
], function($$, promise, utils, lodashGet, lodashSet) {
  return {
    mySmart1: function() {
      console.log("DEBUG: Hello from mySmart1 utils function");
    },
    mySmart2: function() {
      console.log("DEBUG: Hello from mySmart2 utils function");
    }
  };
});