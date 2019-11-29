//const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');

class PuppeteerRenderer {
  constructor (rendererOptions) {
    this._puppeteer = null
    this._rendererOptions = rendererOptions || {}

    if (this._rendererOptions.maxConcurrentRoutes == null) this._rendererOptions.maxConcurrentRoutes = 0

    if (this._rendererOptions.inject && !this._rendererOptions.injectProperty) {
      this._rendererOptions.injectProperty = '__PRERENDER_INJECTED'
    }
  }

  async initialize () {
    try {
      // Workaround for Linux SUID Sandbox issues.
      if (process.platform === 'linux') {
        if (!this._rendererOptions.args) this._rendererOptions.args = []

        if (this._rendererOptions.args.indexOf('--no-sandbox') === -1) {
          this._rendererOptions.args.push('--no-sandbox')
          this._rendererOptions.args.push('--disable-setuid-sandbox')
        }
      }

      // https://bitsofco.de/how-to-use-puppeteer-in-a-netlify-aws-lambda-function/
      this._puppeteer = await chromium.puppeteer.launch({
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
        ...this._rendererOptions,
        args: this._rendererOptions.args
          ? [...new Set([...chromium.args, ...this._rendererOptions.args])]
          : chromium.args
      });

      // Trigger re-initialization in onRequest if Chromium is closed or crashed
      this._puppeteer.on('disconnected', () => {
        this._puppeteer = null;
      })
    } catch (e) {
      console.error(e)
      console.error('[Prerenderer - PuppeteerRenderer] Unable to start Puppeteer')
      // Re-throw the error so it can be handled further up the chain. Good idea or not?
      throw e
    }

    return this._puppeteer
  }

  destroy () {
    this._puppeteer.close()
  }
}

module.exports = PuppeteerRenderer
