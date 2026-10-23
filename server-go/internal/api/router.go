package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// rtr wraps chi.Router so the Go source registers routes with the same
// Hono-style ":param" strings as the TypeScript server (scripts/verify-routes.mjs
// compares them verbatim), translating ":param" to chi "{param}" at
// registration time.
type rtr struct {
	chi.Router
}

// toChi translates Hono ":param" segments to chi "{param}".
func toChi(pattern string) string {
	if !strings.Contains(pattern, ":") {
		return pattern
	}
	var b strings.Builder
	b.Grow(len(pattern) + 8)
	i := 0
	for i < len(pattern) {
		if pattern[i] != ':' {
			b.WriteByte(pattern[i])
			i++
			continue
		}
		j := i + 1
		for j < len(pattern) && pattern[j] != '/' {
			j++
		}
		b.WriteByte('{')
		b.WriteString(pattern[i+1 : j])
		b.WriteByte('}')
		i = j
	}
	return b.String()
}

func (w rtr) Get(pattern string, h http.HandlerFunc) {
	w.Router.Get(toChi(pattern), h)
}
func (w rtr) Post(pattern string, h http.HandlerFunc) {
	w.Router.Post(toChi(pattern), h)
}
func (w rtr) Put(pattern string, h http.HandlerFunc) {
	w.Router.Put(toChi(pattern), h)
}
func (w rtr) Delete(pattern string, h http.HandlerFunc) {
	w.Router.Delete(toChi(pattern), h)
}
func (w rtr) Patch(pattern string, h http.HandlerFunc) {
	w.Router.Patch(toChi(pattern), h)
}

// param extracts a chi URL parameter (Hono's c.req.param).
func param(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}
