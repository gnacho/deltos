// Package ratelimit ports server/src/rate-limit.ts: simple per-user rate
// limit for mutations (POST/PUT/PATCH/DELETE). Sliding 1-minute window,
// 60 mutations max. In-memory is enough for a single-instance self-hosted
// app (same tradeoff as the Node server).
package ratelimit

import (
	"net/http"
	"sync"
	"time"

	"github.com/gnacho/deltos/server-go/internal/errors"
)

const (
	window  = time.Minute
	maxReqs = 60
)

type buckets struct {
	mu sync.Mutex
	m  map[string][]time.Time
}

var b = &buckets{m: map[string][]time.Time{}}

func (bs *buckets) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-window)
	bs.mu.Lock()
	defer bs.mu.Unlock()
	fresh := bs.m[key][:0]
	for _, t := range bs.m[key] {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	if len(fresh) >= maxReqs {
		bs.m[key] = fresh
		return false
	}
	bs.m[key] = append(fresh, now)
	return true
}

// KeyFunc supplies the identity to limit (the session user id).
type KeyFunc func(r *http.Request) string

// Middleware limits mutations per key; GET/HEAD/OPTIONS and requests without
// key pass through, same as mutationRateLimit().
func Middleware(key KeyFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			k := key(r)
			if k == "" {
				next.ServeHTTP(w, r)
				return
			}
			if !b.allow(k) {
				errors.Write(w, errors.New(http.StatusTooManyRequests, errors.RateLimited))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
