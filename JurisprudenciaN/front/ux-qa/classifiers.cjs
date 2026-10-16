'use strict';

function classifyConsoleMessage(type, message) {
  const text = String(message || '');
  if (/nextjs-portal|Next\.js Dev Tools|Download the React DevTools/i.test(text)) return 'NEXT_DEV_TOOLING';
  if (/favicon\.ico|net::ERR_ABORTED|ResizeObserver loop/i.test(text)) return 'BROWSER_NOISE';
  if (type === 'warning' && /Warning: React|Each child in a list|validateDOMNesting|hydration/i.test(text)) return 'REACT_WARNING';
  if (type === 'warning') return 'APPLICATION_WARNING';
  if (type === 'error') return 'APPLICATION_ERROR';
  return 'INFO';
}

function classifyRequestFailure(url, errorText) {
  if (String(url).startsWith('blob:') && /ERR_ABORTED|aborted/i.test(String(errorText))) return 'EXPECTED_BLOB_ABORT';
  if (/ERR_ABORTED|aborted/i.test(String(errorText))) return 'NAVIGATION_ABORT';
  return 'NETWORK_FAILURE';
}

function isExpectedNetworkStatus(url, status) {
  return Number(status) >= 400 && /\.map(?:\?|$)|favicon\.ico/i.test(String(url));
}

module.exports = { classifyConsoleMessage, classifyRequestFailure, isExpectedNetworkStatus };
