// Unit tests must supply their own responses. Never contact a configured editing
// service (or a third-party host) while mounting a component in the test DOM.
// Individual tests can stub fetch to exercise successful requests and failures.
globalThis.fetch = async () => {
  throw new Error('Network unavailable in unit tests; mock fetch for request assertions.');
};
