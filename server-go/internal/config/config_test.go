package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	c, err := Load(env(map[string]string{}))
	if err != nil {
		t.Fatalf("defaults must load: %v", err)
	}
	if c.Port != 3000 || c.DataDir != "./data" || c.StaticDir != "./static" {
		t.Errorf("wrong defaults: %+v", c)
	}
	if c.AuthUser != "admin" || c.CookieSecure || c.MaxSSEClients != 20 || c.MaxUploadMB != 10 {
		t.Errorf("wrong defaults: %+v", c)
	}
}

func TestProductionRequiresSessionSecret(t *testing.T) {
	_, err := Load(env(map[string]string{"NODE_ENV": "production"}))
	if err == nil || !strings.Contains(err.Error(), "SESSION_SECRET") {
		t.Fatalf("production without SESSION_SECRET must fail, got %v", err)
	}
}

func TestSessionSecretMinLength(t *testing.T) {
	_, err := Load(env(map[string]string{"SESSION_SECRET": "short"}))
	if err == nil || !strings.Contains(err.Error(), "at least 32") {
		t.Fatalf("short SESSION_SECRET must fail, got %v", err)
	}
}

func TestPlaceholderSecretsRejected(t *testing.T) {
	for _, v := range []string{"change-me-please-this-is-a-long-secret", "MY-xxx-SECRET-VALUE-32-CHARS"} {
		if _, err := Load(env(map[string]string{"AUTH_PASS": v})); err == nil {
			t.Fatalf("placeholder AUTH_PASS %q must fail", v)
		}
	}
}

func TestPortRange(t *testing.T) {
	if _, err := Load(env(map[string]string{"PORT": "0"})); err == nil {
		t.Fatal("PORT=0 must fail")
	}
	if _, err := Load(env(map[string]string{"PORT": "70000"})); err == nil {
		t.Fatal("PORT=70000 must fail")
	}
	c, err := Load(env(map[string]string{"PORT": "8082"}))
	if err != nil || c.Port != 8082 {
		t.Fatalf("PORT=8082 must load: %v", err)
	}
}

func TestCookieSecureTrue(t *testing.T) {
	c, err := Load(env(map[string]string{"COOKIE_SECURE": "true"}))
	if err != nil || !c.CookieSecure {
		t.Fatalf("COOKIE_SECURE=true must parse: %v", err)
	}
}
