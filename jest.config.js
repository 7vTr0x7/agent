module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  // Browser-backed application tests can legitimately take longer than
  // Jest's 5-second default because Chromium startup and Playwright page
  // operations are part of the test itself. Keep the timeout bounded while
  // avoiding false failures during a full serial test run.
  testTimeout: 30000
};
