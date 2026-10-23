'use strict';

const http = require('node:http');
const { fixtureForRequest } = require('./fixtures.cjs');

function createMockServer() {
  return http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const fixture = fixtureForRequest({
      url: () => new URL(request.url || '/', 'http://ux-qa.mock').toString(),
      method: () => request.method || 'GET',
    });
    response.writeHead(fixture.status, {
      'Content-Type': fixture.contentType,
      ...(Buffer.isBuffer(fixture.body) ? { 'Content-Length': fixture.body.length } : {}),
    });
    response.end(fixture.body);
  });
}

module.exports = { createMockServer };
