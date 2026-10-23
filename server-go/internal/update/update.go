// Package update ports server/src/update.ts: self-update status and apply.
// It detects the latest STABLE release (releases/latest, tag v*) and, when a
// newer version exists, the apply endpoint writes a flag that a systemd .path
// unit picks up (deltos-update.sh runs as root). The server never applies in
// runtime: it only reports and requests.
package update

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
)

// Config carries the update checker configuration.
type Config struct {
	GitHubBase string // GitHub API base, default https://api.github.com
	Repo       string // default gnacho/deltos
	Marker     string // default /opt/deltos/.release-id
}

// DefaultConfig reads the environment and fills the defaults.
func DefaultConfig() Config {
	return Config{
		GitHubBase: "https://api.github.com",
		Repo:       envOr("GITHUB_REPO", "gnacho/deltos"),
		Marker:     envOr("RELEASE_MARKER", "/opt/deltos/.release-id"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

const (
	cacheKey    = "gh_latest_release"
	cacheTTL    = 5 * 60 * 1000
	progressTTL = 15 * 60 * 1000
	progressF   = "update-progress.json"
)

// Status is the update status returned by GET /api/update/status.
type Status struct {
	Current     string  `json:"current"`
	Latest      *string `json:"latest"`
	Available   bool    `json:"available"`
	Notes       string  `json:"notes"`
	CheckFailed bool    `json:"checkFailed"`
}

// Progress is the apply progress returned by GET /api/update/progress.
type Progress struct {
	Step string `json:"step"`
	Pct  int    `json:"pct"`
	TS   int64  `json:"ts"`
}

type release struct {
	ID   string
	Body string
}

// CurrentID reads the installed semver marker (written by deltos-update.sh
// after each deploy); empty when absent.
func (c Config) CurrentID() string {
	marker := c.Marker
	if marker == "" {
		marker = "/opt/deltos/.release-id"
	}
	b, err := os.ReadFile(marker)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func (c Config) base() string {
	if c.GitHubBase == "" {
		return "https://api.github.com"
	}
	return c.GitHubBase
}

func (c Config) repo() string {
	if c.Repo == "" {
		return "gnacho/deltos"
	}
	return c.Repo
}

// latest fetches (and caches for 5 min) the latest stable release from GitHub.
func (c Config) latest(d *db.DB) *release {
	if cached := d.KVGet(cacheKey, ""); cached != "" {
		var x struct {
			At   int64  `json:"at"`
			ID   string `json:"id"`
			Body string `json:"body"`
		}
		if err := json.Unmarshal([]byte(cached), &x); err == nil && time.Now().UnixMilli()-x.At < cacheTTL {
			return &release{ID: x.ID, Body: x.Body}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+"/repos/"+c.repo()+"/releases/latest", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "deltos-updater")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	var data struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}
	id := strings.TrimPrefix(data.TagName, "v")
	cacheVal, _ := json.Marshal(map[string]any{"at": time.Now().UnixMilli(), "id": id, "body": data.Body})
	_ = d.KVSet(cacheKey, string(cacheVal))
	return &release{ID: id, Body: data.Body}
}

// compareSemver compares numeric semver: '1.10.0' > '1.9.0'; 'v' prefixes are
// ignored.
func compareSemver(a, b string) int {
	pa := parseSemver(a)
	pb := parseSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] - pb[i]
		}
	}
	return 0
}

func parseSemver(s string) [3]int {
	s = strings.TrimPrefix(s, "v")
	parts := strings.Split(s, ".")
	var out [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(parts[i])
		out[i] = n
	}
	return out
}

// Status computes the update status (available = a newer stable release than
// the installed marker).
func (c Config) Status(d *db.DB) Status {
	current := c.CurrentID()
	latest := c.latest(d)
	out := Status{Current: current, Notes: "", CheckFailed: latest == nil}
	if latest != nil {
		id := latest.ID
		out.Latest = &id
		out.Notes = latest.Body
		out.Available = current != "" && compareSemver(latest.ID, current) > 0
	}
	return out
}

// ReadProgress reads the apply progress file (written by deltos-update.sh per
// STEP) from DATA_DIR. Only considered live if the ts is recent (15 min).
func ReadProgress(dataDir string) *Progress {
	raw, err := os.ReadFile(filepath.Join(dataDir, progressF))
	if err != nil {
		return nil
	}
	var p struct {
		Step string `json:"step"`
		Pct  any    `json:"pct"`
		TS   int64  `json:"ts"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil
	}
	if p.TS == 0 || time.Now().UnixMilli()-p.TS > progressTTL {
		return nil
	}
	pct := 0
	if f, ok := p.Pct.(float64); ok {
		pct = int(f)
	}
	return &Progress{Step: p.Step, Pct: pct, TS: p.TS}
}
