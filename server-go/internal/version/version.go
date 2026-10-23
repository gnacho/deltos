// Package version holds the server version, injected at build time with
// -ldflags "-X .../internal/version.Version=x.y.z" (default: the current
// server/package.json version, updated on release bumps).
package version

// Version is the Deltos server version.
var Version = "2.6.52"
