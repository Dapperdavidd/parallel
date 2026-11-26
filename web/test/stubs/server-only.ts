/**
 * Stand-in for the `server-only` package under the test runner.
 *
 * `import "server-only"` is a build-time guard: Next resolves it to a module
 * whose browser entry throws, so a server module pulled into a client bundle
 * fails the build instead of shipping. The package is not installed — it comes
 * out of Next's own bundle — so plain Node cannot resolve it.
 *
 * Tests run these modules on the server, which is exactly where the guard
 * permits them, so an empty module is the correct substitute. It is mapped in
 * `tsconfig.test.json`, which Next never reads, so the real guard is untouched.
 */
export {};
