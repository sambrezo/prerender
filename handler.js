const serverless = require('serverless-http');
const express = require('express');
const app = express();

const bodyParser = require('body-parser');
const compression = require('compression');

const server = require('./lib/server');

server.init({
  rendererOptions: {
    inject: { prerendered: true },
    renderAfterDocumentEvent: 'custom-render-trigger',
    //headless: false
  }
});
server.onRequest = server.onRequest.bind(server);

server.use(require('./lib/plugins/basicAuth'));
//server.use(require('./lib/plugins/sendPrerenderHeader'));
server.use(require('./lib/plugins/removeScriptTags'));
server.use(require('./lib/plugins/httpHeaders'));
// postProcess
// Only useful with removeScriptTags disabled
server.use({
  pageLoaded: (req, res, next) => {
    if (req.prerender.content && req.prerender.renderType == 'html') {
      req.prerender.content = req.prerender.content
        .replace(/<script (.*?)>/g, '<script $1 defer>')
        .replace('id="app"', 'id="app" data-server-rendered="true"');
    }
    next();
  }
})
//server.use(require('prerender-aws-s3-cache'))
server.use(require('./lib/plugins/awsS3Cache'))

app.disable('x-powered-by');
app.use(compression());

app.get('*', server.onRequest);

//dont check content-type and just always try to parse body as json
app.post('*', bodyParser.json({ type: () => true }), server.onRequest);

module.exports.render = serverless(app, {
  request: function(req, event, context) {
    // context.callbackWaitsForEmptyEventLoop = false;
    // Pass Lambda event to Express request
    req.event = event;
  }
});