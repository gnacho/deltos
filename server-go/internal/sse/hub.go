// Package sse ports server/src/sse.ts: a Server-Sent Events hub with named
// events <domain>.changed, a strictly monotonic in-memory event id, hello on
// connect, sync.resync when the Last-Event-ID is behind, broadcast to all
// clients and a shutdown event.
package sse

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
)

// domainSingular maps an entity (plural) to its domain name for the event
// name; entities without an entry use themselves (e.g. gamification).
var domainSingular = map[string]string{
	"users":       "user",
	"projects":    "project",
	"tasks":       "task",
	"labels":      "label",
	"comments":    "comment",
	"attachments": "attachment",
	"settings":    "settings",
	"decisions":   "decision",
	"expenses":    "expense",
}

// EventName returns the named event for an entity: "<domain>.changed".
func EventName(entity string) string {
	if d, ok := domainSingular[entity]; ok {
		return d + ".changed"
	}
	return entity + ".changed"
}

// Client writes a single SSE event. Implemented by HTTPClient and by test
// doubles.
type Client interface {
	WriteEvent(id, event, data string) error
}

// Hub is the SSE broadcaster. Concurrency-safe.
type Hub struct {
	mu         sync.Mutex
	clients    map[Client]struct{}
	seq        int64
	maxClients int
}

// NewHub builds a hub with the given client cap.
func NewHub(maxClients int) *Hub {
	return &Hub{clients: make(map[Client]struct{}), maxClients: maxClients}
}

// MaxClients returns the configured client cap.
func (h *Hub) MaxClients() int { return h.maxClients }

// Size returns the number of connected clients.
func (h *Hub) Size() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// Seq returns the current event sequence.
func (h *Hub) Seq() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.seq
}

// Add registers a client.
func (h *Hub) Add(c Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

// Remove unregisters a client (safe if already gone).
func (h *Hub) Remove(c Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

// Hello sends the initial greeting (also carries an id).
func (h *Hub) Hello(c Client) {
	h.mu.Lock()
	h.seq++
	id := strconv.FormatInt(h.seq, 10)
	h.mu.Unlock()
	_ = c.WriteEvent(id, "hello", `{"ok":true}`)
}

// Resync sends one sync.resync when the client missed events (lastEventID is
// older than the current sequence).
func (h *Hub) Resync(c Client, lastEventID string) {
	last, err := strconv.ParseInt(lastEventID, 10, 64)
	h.mu.Lock()
	if err != nil || last >= h.seq {
		h.mu.Unlock()
		return
	}
	h.seq++
	id := strconv.FormatInt(h.seq, 10)
	h.mu.Unlock()
	_ = c.WriteEvent(id, "sync.resync", `{"type":"changed","entity":"*"}`)
}

// Broadcast notifies every client that an entity changed, dropping clients
// whose write fails.
func (h *Hub) Broadcast(entity string) {
	event := EventName(entity)
	payload, _ := json.Marshal(struct {
		Type   string `json:"type"`
		Entity string `json:"entity"`
	}{Type: "changed", Entity: entity})
	data := string(payload)
	h.mu.Lock()
	h.seq++
	id := strconv.FormatInt(h.seq, 10)
	clients := make([]Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	for _, c := range clients {
		if c.WriteEvent(id, event, data) != nil {
			h.Remove(c)
		}
	}
}

// Shutdown notifies every client and clears the set.
func (h *Hub) Shutdown() {
	h.mu.Lock()
	clients := make([]Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.clients = make(map[Client]struct{})
	h.mu.Unlock()
	for _, c := range clients {
		_ = c.WriteEvent("", "shutdown", "{}")
	}
}

// WriteEvent formats a single SSE event (id, event, data) to w.
func WriteEvent(w interface{ Write([]byte) (int, error) }, id, event, data string) error {
	b := make([]byte, 0, len(id)+len(event)+len(data)+16)
	if id != "" {
		b = append(b, "id: "+id+"\n"...)
	}
	if event != "" {
		b = append(b, "event: "+event+"\n"...)
	}
	b = append(b, "data: "+data+"\n\n"...)
	_, err := w.Write(b)
	return err
}

// HTTPClient adapts an http.ResponseWriter + Flusher into a Client.
type HTTPClient struct {
	w http.ResponseWriter
	f http.Flusher
}

// NewHTTPClient builds a client that flushes after each event.
func NewHTTPClient(w http.ResponseWriter, f http.Flusher) *HTTPClient {
	return &HTTPClient{w: w, f: f}
}

// WriteEvent writes and flushes one event.
func (c *HTTPClient) WriteEvent(id, event, data string) error {
	if err := WriteEvent(c.w, id, event, data); err != nil {
		return err
	}
	c.f.Flush()
	return nil
}
