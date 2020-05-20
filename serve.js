const fs = require('fs');
const express = require('express');
const path = require('path');

var app = express();

var indexPath = path.join(__dirname + '/static/index.html');
var appPath = path.join(__dirname + '/static/app.js');

function redirect (request, response, next) {
  if (request.url.endsWith('/app/bookAboard')) {
      response.redirect('/app/bookAboard/');
  } else {
    next();
  }
}

if (process.argv[2] === 'develop') {
  app.get('/app/bookAboard/static/app.js', (request, response) => {
    let appFile = fs.readFileSync(appPath);
    response.send(appFile);
  });
  app.use('/app/bookAboard/static/', express.static('static', { maxAge: 1 }));
  app.get('/app/bookAboard', redirect, function(request, response) {
    response.sendFile(indexPath);
  });

} else {
  var staticConf = { maxAge: 360000 * 1000 };

  app.get('/app/bookAboard/static/app.js', (request, response) => {
    let appFile = fs.readFileSync(appPath);
    appFile = appFile.toString().replace('$BUILD_NUM$', process.env['BUILD_NUM']);
    response.send(appFile);
  });

  app.get('/app/bookAboard/', (request, response) => {
    let indexFile = fs.readFileSync(indexPath);
    indexFile = indexFile.toString().replace(/\$BUILD_NUM\$/g, process.env['BUILD_NUM']);
    response.send(indexFile);
  });

  app.use('/app/bookAboard/static/', express.static('static', staticConf));
}

app.listen(8080, () => {
  console.log('process app ready for processing on port 8080');
});
