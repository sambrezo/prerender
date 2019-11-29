const util = require('./util.js');
const zlib = require('zlib');
const validUrl = require('valid-url');
const url = require('url');

const PuppeteerRenderer = require('./renderer');

const WAIT_AFTER_LAST_REQUEST = process.env.WAIT_AFTER_LAST_REQUEST || 500;

const PAGE_DONE_CHECK_INTERVAL = process.env.PAGE_DONE_CHECK_INTERVAL || 500;

const PAGE_LOAD_TIMEOUT = process.env.PAGE_LOAD_TIMEOUT || 20 * 1000;

const FOLLOW_REDIRECTS = process.env.FOLLOW_REDIRECTS || false;

const LOG_REQUESTS = process.env.LOG_REQUESTS || false;

const ENABLE_SERVICE_WORKER = process.env.ENABLE_SERVICE_WORKER || false;

//delay incoming requests and force browser to restart before proceeding with requests
const BROWSER_FORCE_RESTART_PERIOD = process.env.BROWSER_FORCE_RESTART_PERIOD || 3600000;

//try to restart the browser only if there are zero requests in flight
const BROWSER_TRY_RESTART_PERIOD = process.env.BROWSER_TRY_RESTART_PERIOD || 600000;

const server = exports = module.exports = {};



server.init = function(options) {
	this.plugins = this.plugins || [];
	this.options = options || {};

	this.options.waitAfterLastRequest = this.options.waitAfterLastRequest || WAIT_AFTER_LAST_REQUEST;
	this.options.pageDoneCheckInterval = this.options.pageDoneCheckInterval || PAGE_DONE_CHECK_INTERVAL;
	this.options.pageLoadTimeout = this.options.pageLoadTimeout || PAGE_LOAD_TIMEOUT;
	this.options.followRedirects = this.options.followRedirects || FOLLOW_REDIRECTS;
	this.options.logRequests = this.options.logRequests || LOG_REQUESTS;
	this.options.enableServiceWorker = this.options.enableServiceWorker || ENABLE_SERVICE_WORKER;
	this.options.pdfOptions = this.options.pdfOptions || {
		printBackground: true
	};

  this.options.rendererOptions = this.options.rendererOptions || {};
	this.renderer = new PuppeteerRenderer({
    ...this.options.rendererOptions
  });

	return this;
};



server.use = function(plugin) {
	this.plugins.push(plugin);
	if (typeof plugin.init === 'function') plugin.init(this);
};



server.onRequest = function(req, res) {

	req.prerender = util.getOptions(req);
	req.prerender.start = new Date();
  req.prerender.responseSent = false;
  
  const rendererOptions = this.renderer._rendererOptions;

	util.log('getting', req.prerender.url);

	this.firePluginEvent('requestReceived', req, res)
	.then(() => {

		if (!validUrl.isWebUri(encodeURI(req.prerender.url))) {
			util.log('invalid URL:', req.prerender.url);
			req.prerender.statusCode = 400;
			return Promise.reject();
		}

    if (!this.renderer._puppeteer) {
      return this.renderer.initialize();
    }
	}).then(() => {

    // return this.browser.openTab(req.prerender);
    return this.renderer._puppeteer.newPage();
	}).then((page) => {

    // req.prerender.tab = tab;
    req.prerender.page = page;

    page.setCacheEnabled(false);
    
    if (rendererOptions.consoleHandler) {
      page.on('console', message => rendererOptions.consoleHandler(req.prerender.url, message))
    }

		// return this.firePluginEvent('tabCreated', req, res);
		return this.firePluginEvent('pageCreated', req, res);
	}).then(async () => {

    // return this.browser.loadUrlThenWaitForPageLoadEvent(req.prerender.tab, req.prerender.url);
    
    const page = req.prerender.page;

    if (rendererOptions.inject) {
      await page.evaluateOnNewDocument(`(function () { window['${rendererOptions.injectProperty}'] = ${JSON.stringify(rendererOptions.inject)}; })();`)
    }

    // const baseURL = `http://localhost:${rootOptions.server.port}`
    const parts = url.parse(req.prerender.url);
    const baseURL = `${parts.protocol}://${parts.host}`;

    // Allow setting viewport widths and such.
    if (rendererOptions.viewport) await page.setViewport(rendererOptions.viewport)

    // await this.handleRequestInterception(page, baseURL)
    // await page.setRequestInterception(true)

    // page.on('request', req => {
    //   // Skip third party requests if needed.
    //   if (rendererOptions.skipThirdPartyRequests) {
    //     if (!req.url().startsWith(baseURL)) {
    //       req.abort()
    //       return
    //     }
    //   }

    //   req.continue()
    // })

    // Hack just in-case the document event fires before our main listener is added.
    if (rendererOptions.renderAfterDocumentEvent) {
      page.evaluateOnNewDocument(function (options) {
        window['__PRERENDER_STATUS'] = {}
        document.addEventListener(options.renderAfterDocumentEvent, () => {
          window['__PRERENDER_STATUS'].__DOCUMENT_EVENT_RESOLVED = true
        })
      }, rendererOptions)
    }
    
    const navigationOptions = (rendererOptions.navigationOptions) ? { waituntil: 'networkidle0', ...rendererOptions.navigationOptions } : { waituntil: 'networkidle0' };
    req.prerender.response = await page.goto(req.prerender.url, navigationOptions);

    // Wait for some specific element exists
    const { renderAfterElementExists } = rendererOptions
    if (renderAfterElementExists && typeof renderAfterElementExists === 'string') {
      await page.waitForSelector(renderAfterElementExists)
    }
    // Once this completes, it's safe to capture the page contents.
    await page.evaluate(function (options) {
      options = options || {}
    
      return new Promise((resolve, reject) => {
        // Render when an event fires on the document.
        if (options.renderAfterDocumentEvent) {
          if (window['__PRERENDER_STATUS'] && window['__PRERENDER_STATUS'].__DOCUMENT_EVENT_RESOLVED) resolve()
          document.addEventListener(options.renderAfterDocumentEvent, () => resolve())
    
        // Render after a certain number of milliseconds.
        } else if (options.renderAfterTime) {
          setTimeout(() => resolve(), options.renderAfterTime)
    
        // Default: Render immediately after page content loads.
        } else {
          resolve()
        }
      })
    }, rendererOptions)
	}).then(() => {
    return req.prerender.page.evaluate(function () {
      const app = document.querySelector('#app');
      const store = app.__vue__.$store;
      const script = document.createElement(`script`);      
      script.innerHTML = `window.__INITIAL_STATE__ = ${JSON.stringify(store.state)}`;
      document.head.appendChild(script);
      return Promise.resolve()
    })
	}).then(() => {

		// if (req.prerender.javascript) {
		// 	return this.browser.executeJavascript(req.prerender.tab, req.prerender.javascript);
		// } else {
		// 	return Promise.resolve();
		// }
	}).then(() => {

		// return this.browser.parseHtmlFromPage(req.prerender.tab);
	}).then(async () => {

		req.prerender.statusCode = req.prerender.response.status()
		//req.prerender.prerenderData = req.prerender.tab.prerender.prerenderData;
		req.prerender.content = await req.prerender.page.content()
    req.prerender.headers = req.prerender.response.headers();
    
    req.prerender.route = await req.prerender.page.evaluate('window.location.pathname');

    return this.firePluginEvent('pageLoaded', req, res);
	}).then(async () => {
    await req.prerender.page.close();    
    // await this.renderer._puppeteer.close();
	}).then(() => {
		this.finish(req, res);
	}).catch((err) => {
		if (err) util.log(err);
    this.finish(req, res);
	});
};



server.finish = function(req, res) {
	this.firePluginEvent('beforeSend', req, res)
		.then(() => {
			this._send(req, res);
		}).catch(() => {
			this._send(req, res);
		});
};



server.firePluginEvent = function(methodName, req, res) {
	return new Promise((resolve, reject) => {
		let index = 0;
		let done = false;
		let next = null;
		var newRes = {};
		var args = [req, newRes];

		newRes.send = function(statusCode, content) {
			if (statusCode) req.prerender.statusCode = statusCode;
			if (content) req.prerender.content = content;
			done = true;
			reject();
		};

		newRes.setHeader = function(key, value) {
			res.setHeader(key, value);
		}

		next = () => {
			if (done) return;

			let layer = this.plugins[index++];
			if (!layer) {
				return resolve();
			}

			let method = layer[methodName];

			if (method) {
				try {
					method.apply(layer, args);
				} catch (e) {
					util.log(e);
					next();
				}
			} else {
				next();
			}
		};

		args.push(next);
		next();
	});
};



server._send = function(req, res) {

	req.prerender.statusCode = parseInt(req.prerender.statusCode) || 504;
	let contentTypes = {
		'jpeg': 'image/jpeg',
		'png': 'image/png',
		'pdf': 'application/pdf',
		'har': 'application/json'
	}

	if (req.prerender.renderType == 'html') {
		Object.keys(req.prerender.headers || {}).forEach(function(header) {
			try {
				res.setHeader(header, req.prerender.headers[header]);
			} catch (e) {
				util.log('warning: unable to set header:', header);
			}
		});
	}

	if (req.prerender.prerenderData) {
		res.setHeader('Content-Type', 'application/json');
	} else {
		res.setHeader('Content-Type', contentTypes[req.prerender.renderType] || 'text/html;charset=UTF-8');
	}

	if (!req.prerender.prerenderData) {

		if (req.prerender.content) {
			if (Buffer.isBuffer(req.prerender.content)) {
				res.setHeader('Content-Length', req.prerender.content.length);
			} else if (typeof req.prerender.content === 'string'){
				res.setHeader('Content-Length', Buffer.byteLength(req.prerender.content, 'utf8'));
			}
		}
	}

	//if the original server had a chunked encoding, we should remove it since we aren't sending a chunked response
	res.removeHeader('Transfer-Encoding');
	//if the original server wanted to keep the connection alive, let's close it
	res.removeHeader('Connection');
	//getting 502s for sites that return these headers
	res.removeHeader('X-Content-Security-Policy');
	res.removeHeader('Content-Security-Policy');
	res.removeHeader('Content-Encoding');

	res.status(req.prerender.statusCode);

	if (req.prerender.prerenderData) {
		res.json({
			prerenderData: req.prerender.prerenderData,
			content: req.prerender.content
		});
	}

	if (!req.prerender.prerenderData && req.prerender.content) {
		res.send(req.prerender.content);
	}

	if (!req.prerender.content) {
		res.end();
	}

	var ms = new Date().getTime() - req.prerender.start.getTime();
	util.log('got', req.prerender.statusCode, 'in', ms + 'ms', 'for', req.prerender.url);
};