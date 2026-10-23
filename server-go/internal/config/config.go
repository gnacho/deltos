// Package config loads and validates the server configuration from
// environment variables. It mirrors server/src/config.ts: fast fail on
// invalid config, placeholder detection for secrets, same defaults.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config is the validated configuration (equivalent of Config in config.ts).
type Config struct {
	Port            int
	DataDir         string
	StaticDir       string
	SessionSecret   string // empty in dev => generated and persisted in kv
	AuthUser        string
	AuthPass        string
	CookieSecure    bool
	TrustedProxy    string
	MaxSSEClients   int
	MaxUploadMB     int
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	// VAPIDSubject MUST be a mailto: URI (e.g. mailto:admin@example.com): an
	// https://localhost subject breaks Safari with BadJwtToken.
	VAPIDSubject string
}

// placeholderMarkers are rejected in secrets: they mean someone kept a value
// from .env.example (same list as config.ts).
var placeholderMarkers = []string{
	"cambia", "changeme", "change-me", "example", "placeholder", "your-secret", "replace_me", "xxx",
}

func envOr(env map[string]string, key, def string) string {
	if v, ok := env[key]; ok && v != "" {
		return v
	}
	return def
}

func envInt(env map[string]string, key string, def, min, max int) (int, error) {
	raw := envOr(env, key, strconv.Itoa(def))
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: invalid integer %q", key, raw)
	}
	if n < min || n > max {
		return 0, fmt.Errorf("%s: %d out of range [%d,%d]", key, n, min, max)
	}
	return n, nil
}

// Load reads the environment (or the provided map in tests) and validates it.
// NODE_ENV=production requires SESSION_SECRET (issue #168).
func Load(getenv func(string) string) (*Config, error) {
	env := map[string]string{}
	for _, k := range []string{
		"NODE_ENV", "PORT", "DATA_DIR", "STATIC_DIR", "SESSION_SECRET",
		"AUTH_USER", "AUTH_PASS", "COOKIE_SECURE", "TRUSTED_PROXY",
		"MAX_SSE_CLIENTS", "MAX_UPLOAD_MB",
		"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
	} {
		env[k] = getenv(k)
	}

	port, err := envInt(env, "PORT", 3000, 1, 65535)
	if err != nil {
		return nil, err
	}
	maxSSE, err := envInt(env, "MAX_SSE_CLIENTS", 20, 1, 200)
	if err != nil {
		return nil, err
	}
	maxUpload, err := envInt(env, "MAX_UPLOAD_MB", 10, 1, 100)
	if err != nil {
		return nil, err
	}

	dataDir := envOr(env, "DATA_DIR", "./data")
	staticDir := envOr(env, "STATIC_DIR", "./static")
	authUser := envOr(env, "AUTH_USER", "admin")
	cookieSecure := strings.EqualFold(envOr(env, "COOKIE_SECURE", "false"), "true")

	cfg := &Config{
		Port:            port,
		DataDir:         dataDir,
		StaticDir:       staticDir,
		SessionSecret:   env["SESSION_SECRET"],
		AuthUser:        authUser,
		AuthPass:        env["AUTH_PASS"],
		CookieSecure:    cookieSecure,
		TrustedProxy:    env["TRUSTED_PROXY"],
		MaxSSEClients:   maxSSE,
		MaxUploadMB:     maxUpload,
		VAPIDPublicKey:  env["VAPID_PUBLIC_KEY"],
		VAPIDPrivateKey: env["VAPID_PRIVATE_KEY"],
		VAPIDSubject:    env["VAPID_SUBJECT"],
	}

	if env["NODE_ENV"] == "production" && cfg.SessionSecret == "" {
		return nil, fmt.Errorf("SESSION_SECRET is required in production (issue #168)")
	}
	if cfg.AuthPass != "" {
		if err := checkPlaceholder("AUTH_PASS", cfg.AuthPass); err != nil {
			return nil, err
		}
	}
	if cfg.SessionSecret != "" {
		if len(cfg.SessionSecret) < 32 {
			return nil, fmt.Errorf("SESSION_SECRET: must be at least 32 characters")
		}
		if err := checkPlaceholder("SESSION_SECRET", cfg.SessionSecret); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// LoadFromEnv is Load over the real process environment.
func LoadFromEnv() (*Config, error) { return Load(os.Getenv) }

func checkPlaceholder(key, val string) error {
	lower := strings.ToLower(val)
	for _, m := range placeholderMarkers {
		if strings.Contains(lower, m) {
			return fmt.Errorf("%s contains an example value from .env.example; generate a real secret", key)
		}
	}
	return nil
}
