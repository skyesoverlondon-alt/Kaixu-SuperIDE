// tests/__mocks__/@sentry/node.js — Mock Sentry for test environment
const noop = () => {};
const Sentry = {
  init:            noop,
  captureException: jest.fn(),
  captureMessage:  jest.fn(),
  withScope:       jest.fn((cb) => cb({ setTag: noop, setExtras: noop, setExtra: noop })),
  setUser:         noop,
  addBreadcrumb:   noop,
};
module.exports = Sentry;
