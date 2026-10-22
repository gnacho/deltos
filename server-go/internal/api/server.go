// Package api ports the base of server/src/app.ts (phase 1): wide event,
// security headers, body limit, auth middleware, demo read-only, CSRF,
// mutation rate limit, auth endpoints, version, health, statics + SPA
// fallback and the single error envelope. Domain routes arrive in later
// phases (2-6).
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/gnacho/deltos/server-go/internal/auth"
	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/errors"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/logger"
	"github.com/gnacho/deltos/server-go/internal/ratelimit"
)

var log = logger.L().Child(map[string]any{"component": "api"})

// Config is what the server needs from the validated configuration
// (AppConfig in app.ts).
type Config struct {
	CookieSecure bool
	MaxUploadMB  int
	StaticDir    string
	Version      string
	Build        string
	TrustedProxy string
}

// Server is the HTTP application (equivalent of createApp context).
type Server struct {
	Auth    *auth.Service
	Prod    *db.DB
	Demo    *db.DB
	Cfg     Config
	started time.Time
	router  chi.Router
}

// New builds the application router. Route registration order mirrors app.ts.
func New(a *auth.Service, prod, demo *db.DB, cfg Config) *Server {
	s := &Server{Auth: a, Prod: prod, Demo: demo, Cfg: cfg, started: time.Now()}
	maxBody := int64(cfg.MaxUploadMB)*1024*1024 + 1024*1024

	r := chi.NewRouter()

	// Wide event: one JSON line per request at the end (log-ops). Excludes
	// /health and /api/events (SSE).
	r.Use(s.wideEvent)

	// Security headers (same-origin SPA: closed CSP).
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
			if cfg.CookieSecure {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			h.Set("Content-Security-Policy",
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "+
					"img-src 'self' data: blob:; connect-src 'self' https://api.github.com")
			next.ServeHTTP(w, req)
		})
	})

	// Panic recovery: a bug in a handler is a 500 INTERNAL_ERROR envelope,
	// never a dropped connection.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic_recovered", "path", req.URL.Path, "panic", fmt.Sprint(rec))
					errors.Write(w, errors.New(http.StatusInternalServerError, errors.InternalError))
				}
			}()
			next.ServeHTTP(w, req)
		})
	})

	r.Use(middleware.RequestID)

	// /api/* group: body limit, auth, demo read-only, CSRF, rate limit.
	r.Route("/api", func(api chi.Router) {
		api.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.ContentLength > maxBody {
					errors.Write(w, errors.New(http.StatusRequestEntityTooLarge, errors.PayloadTooLarge))
					return
				}
				// Chunked bodies have no Content-Length: cap with MaxBytesReader.
				req.Body = http.MaxBytesReader(w, req.Body, maxBody)
				next.ServeHTTP(w, req)
			})
		})
		api.Use(a.RequireAuth)
		api.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				switch req.Method {
				case http.MethodGet, http.MethodHead, http.MethodOptions:
					next.ServeHTTP(w, req)
					return
				}
				if !auth.DemoFrom(req) {
					next.ServeHTTP(w, req)
					return
				}
				errors.Write(w, errors.New(http.StatusForbidden, errors.DemoReadOnly))
			})
		})
		api.Use(csrf(a))
		api.Use(ratelimit.Middleware(func(req *http.Request) string {
			if u := auth.UserFrom(req); u != nil {
				return u.ID
			}
			return ""
		}))

		// --- Auth endpoints (phase 1 scope) ---
		api.Post("/auth/login", s.handleLogin)
		api.Post("/auth/logout", s.handleLogout)
		api.Get("/auth/me", s.handleMe)
		api.Post("/auth/register", s.handleRegister)
		api.Get("/version", s.handleVersion)
	})

	// Unmatched /api routes are 404 NOT_FOUND (never the SPA fallback).
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/api/") || strings.HasPrefix(req.URL.Path, "/assets/") {
			errors.Write(w, errors.New(http.StatusNotFound, errors.NotFound))
			return
		}
		s.serveSPA(w, req)
	})

	// Health (outside /api, same as the Node server).
	r.Get("/health", s.handleHealth)

	s.router = r
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, req *http.Request) { s.router.ServeHTTP(w, req) }

func csrf(a *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			switch req.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, req)
				return
			}
			if auth.UserFrom(req) == nil {
				next.ServeHTTP(w, req)
				return
			}
			res := a.ResolveSession(req)
			expected := ""
			if res != nil {
				expected = res.CSRFToken
			}
			given := req.Header.Get("X-Csrf-Token")
			if expected == "" || given == "" || expected != given {
				errors.Write(w, errors.New(http.StatusForbidden, errors.CSRFInvalid))
				return
			}
			next.ServeHTTP(w, req)
		})
	}
}

func (s *Server) wideEvent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/health" || req.URL.Path == "/api/events" {
			next.ServeHTTP(w, req)
			return
		}
		requestID := ids.New()
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			userID := ""
			if u := auth.UserFrom(req); u != nil {
				userID = u.ID
			}
			log.Info("request",
				"request_id", requestID,
				"method", req.Method,
				"path", req.URL.Path,
				"status", ww.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"user_id", userID,
			)
		}()
		next.ServeHTTP(ww, req)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status = code
		w.wrote = true
	}
	w.ResponseWriter.WriteHeader(code)
}

// --- Handlers ----------------------------------------------------------------

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	// loginSchema: username 1..50, password 1..100.
	var issues []issue
	if len(body.Username) < 1 || len(body.Username) > 50 {
		issues = append(issues, issue{Path: []string{"username"}, Message: "username must be 1-50 characters"})
	}
	if len(body.Password) < 1 || len(body.Password) > 100 {
		issues = append(issues, issue{Path: []string{"password"}, Message: "password must be 1-100 characters"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	if auth.LoginRateLimited(s.Prod, r, s.Cfg.TrustedProxy) {
		errors.Write(w, errors.New(http.StatusTooManyRequests, errors.AuthRateLimited))
		return
	}
	user, err := auth.VerifyLogin(s.Prod, body.Username, body.Password)
	if err != nil {
		errors.Write(w, errors.New(http.StatusInternalServerError, errors.InternalError))
		return
	}
	if user == nil {
		_ = auth.RegisterLoginFail(s.Prod, r, s.Cfg.TrustedProxy)
		errors.Write(w, errors.New(http.StatusUnauthorized, errors.AuthInvalidCreds))
		return
	}
	_ = auth.LoginOK(s.Prod, r, s.Cfg.TrustedProxy)
	// Session rotation after a successful login (prevents session fixation).
	if previous := s.Auth.ResolveSession(r); previous != nil {
		_ = auth.DestroySession(previous.DB, previous.SessionID)
	}
	sessionID, csrfToken, err := auth.CreateSession(s.Prod, user.ID, r.Header.Get("User-Agent"))
	if err != nil {
		errors.Write(w, errors.New(http.StatusInternalServerError, errors.InternalError))
		return
	}
	s.Auth.SetCookie(w, sessionID, auth.SessionTTL)
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "demo": false, "csrfToken": csrfToken})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if res := s.Auth.ResolveSession(r); res != nil {
		_ = auth.DestroySession(res.DB, res.SessionID)
	}
	s.Auth.ClearCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	csrfToken := any(nil)
	if res := s.Auth.ResolveSession(r); res != nil {
		csrfToken = res.CSRFToken
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      auth.UserFrom(r),
		"demo":      auth.DemoFrom(r),
		"csrfToken": csrfToken,
	})
}

type registerRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Color    string `json:"color"`
	Language string `json:"language"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFrom(r)
	if user == nil || user.Role != "admin" {
		errors.Write(w, errors.New(http.StatusForbidden, errors.AuthForbidden))
		return
	}
	var body registerRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		validationFailed(w, []issue{{Path: []string{"body"}, Message: "invalid JSON"}})
		return
	}
	// registerSchema: username 1..50, password 10..100, color ^[a-z]{2,20}$
	// (default slate), language auto|es|en (default auto).
	var issues []issue
	if len(body.Username) < 1 || len(body.Username) > 50 {
		issues = append(issues, issue{Path: []string{"username"}, Message: "username must be 1-50 characters"})
	}
	if len(body.Password) < 10 || len(body.Password) > 100 {
		issues = append(issues, issue{Path: []string{"password"}, Message: "la contraseña debe tener al menos 10 caracteres"})
	}
	color := body.Color
	if color == "" {
		color = "slate"
	}
	if len(color) < 2 || len(color) > 20 || !isLowerAlpha(color) {
		issues = append(issues, issue{Path: []string{"color"}, Message: "invalid color"})
	}
	language := body.Language
	if language == "" {
		language = "auto"
	}
	if language != "auto" && language != "es" && language != "en" {
		issues = append(issues, issue{Path: []string{"language"}, Message: "invalid language"})
	}
	if len(issues) > 0 {
		validationFailed(w, issues)
		return
	}
	created, err := auth.RegisterUser(s.Prod, body.Username, body.Password, color, language, "user")
	if err != nil {
		errors.Write(w, errors.New(http.StatusInternalServerError, errors.InternalError))
		return
	}
	if created == nil {
		errors.Write(w, errors.New(http.StatusConflict, errors.UserAlreadyExists))
		return
	}
	w.Header().Set("Location", "/api/users/"+created.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "user": created})
}

func isLowerAlpha(s string) bool {
	for _, c := range s {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

type issue struct {
	Path    []string `json:"path"`
	Message string   `json:"message"`
}

func validationFailed(w http.ResponseWriter, issues []issue) {
	e := errors.New(http.StatusUnprocessableEntity, errors.ValidationFailed).WithDetails(map[string]any{"issues": issues})
	errors.Write(w, e)
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version": s.Cfg.Version,
		"build":   s.Cfg.Build,
		"node":    strings.TrimPrefix(runtime.Version(), "go"),
		"uptime":  time.Since(s.started).Seconds(),
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	dbOk := true
	if err := s.Prod.Ping(); err != nil {
		dbOk = false
	}
	if s.Demo != nil {
		if err := s.Demo.Ping(); err != nil {
			dbOk = false
		}
	}
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	status := "ok"
	dbState := "connected"
	if !dbOk {
		status = "degraded"
		dbState = "error"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": status,
		"uptime": time.Since(s.started).Seconds(),
		"memory": map[string]any{"rss": mem.Sys, "heap": mem.HeapAlloc},
		"db":     dbState,
	})
}

// --- Statics + SPA fallback ---------------------------------------------------

func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if p == "/sw.js" || strings.HasSuffix(p, ".html") || p == "/" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	full := filepath.Join(s.Cfg.StaticDir, filepath.Clean("/"+p))
	if info, err := os.Stat(full); err == nil && !info.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	// index.html is read on EVERY request (deploys by rsync without restart).
	html, err := os.ReadFile(filepath.Join(s.Cfg.StaticDir, "index.html"))
	if err != nil {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Deltos</title>" +
			"<body><h1>Deltos - API</h1><p>El frontend a&uacute;n no est&aacute; compilado (app/dist). " +
			"La API responde en /api/* y /health.</p></body></html>"))
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(html)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
