const url = require('url');
const crypto = require('crypto');
const AWS = require('aws-sdk');

var s3 = new AWS.S3({ region: 'eu-central-1' });

function getS3ObjectKey(prerenderUrl) {
  const pathname = url.parse(prerenderUrl).pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  var key = (pathname ? pathname : 'index') + '/' +
    crypto.createHash('md5').update(prerenderUrl).digest("hex");
  if (process.env.S3_PREFIX_KEY) {
    key = process.env.S3_PREFIX_KEY + '/' + key;
  }
  return key;
}

module.exports = {

	requestReceived: function(req, res, next) {

		if(req.method !== 'GET') {
			return next();
		}

    const key = getS3ObjectKey(req.prerender.url)

		s3.getObject({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key
		}, function (err, result) {
      
      res.setHeader('X-S3-Cache-Key', key);
			if (!err && result) {
				return res.send(200, result.Body);
			}

			next();
		});
	},

	pageLoaded: function(req, res, next) {

		if(req.prerender.statusCode !== 200) {
			return next();
		}

    const key = getS3ObjectKey(req.prerender.url);
		
		s3.putObject({
      Bucket: process.env.S3_BUCKET_NAME,      
			Key: key,
			ContentType: 'text/html;charset=UTF-8',
			StorageClass: 'REDUCED_REDUNDANCY',
			Body: req.prerender.content
		}, function(err, result) {

			if (err) console.error(err);

			next();
		});
	}
};