const serverless = require('serverless-http');

let handler;
try {
  const { createApp } = require('../../app');
  handler = serverless(createApp());
} catch (e) {
  console.error('INIT ERROR:', e);
  handler = async () => ({ statusCode: 500, body: JSON.stringify({ napaka: e.message }) });
}

module.exports.handler = handler;
