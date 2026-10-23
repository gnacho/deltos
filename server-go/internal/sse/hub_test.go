package sse

import (
	"bytes"
	"strings"
	"sync"
	"testing"
)

type recorded struct {
	ID    string
	Event string
	Data  string
}

type recClient struct {
	mu     sync.Mutex
	events []recorded
	err    error
}

func (r *recClient) WriteEvent(id, event, data string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recorded{ID: id, Event: event, Data: data})
	return r.err
}

func (r *recClient) snapshot() []recorded {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]recorded, len(r.events))
	copy(out, r.events)
	return out
}

func TestEventName(t *testing.T) {
	cases := map[string]string{
		"users":        "user.changed",
		"projects":     "project.changed",
		"tasks":        "task.changed",
		"labels":       "label.changed",
		"comments":     "comment.changed",
		"attachments":  "attachment.changed",
		"settings":     "settings.changed",
		"decisions":    "decision.changed",
		"expenses":     "expense.changed",
		"gamification": "gamification.changed",
	}
	for entity, want := range cases {
		if got := EventName(entity); got != want {
			t.Errorf("EventName(%q) = %q, want %q", entity, got, want)
		}
	}
}

func TestHello(t *testing.T) {
	h := NewHub(10)
	c := &recClient{}
	h.Add(c)
	h.Hello(c)
	ev := c.snapshot()
	if len(ev) != 1 {
		t.Fatalf("expected 1 event, got %d", len(ev))
	}
	if ev[0].Event != "hello" || ev[0].ID != "1" || ev[0].Data != `{"ok":true}` {
		t.Fatalf("hello event wrong: %+v", ev[0])
	}
	if h.Seq() != 1 {
		t.Fatalf("seq should be 1 after hello, got %d", h.Seq())
	}
}

func TestBroadcastMonotonicID(t *testing.T) {
	h := NewHub(10)
	a, b := &recClient{}, &recClient{}
	h.Add(a)
	h.Add(b)
	h.Broadcast("tasks")
	h.Broadcast("projects")
	ea := a.snapshot()
	eb := b.snapshot()
	if len(ea) != 2 || len(eb) != 2 {
		t.Fatalf("expected 2 events each, got %d/%d", len(ea), len(eb))
	}
	if ea[0].ID != "1" || ea[1].ID != "2" {
		t.Fatalf("ids must be strictly monotonic: %+v", ea)
	}
	if ea[0].Event != "task.changed" || ea[0].Data != `{"type":"changed","entity":"tasks"}` {
		t.Fatalf("broadcast payload wrong: %+v", ea[0])
	}
	if ea[1].Event != "project.changed" || ea[1].Data != `{"type":"changed","entity":"projects"}` {
		t.Fatalf("broadcast payload wrong: %+v", ea[1])
	}
	// both clients see the same id
	if ea[0].ID != eb[0].ID || ea[1].ID != eb[1].ID {
		t.Fatalf("clients must see the same ids: %+v vs %+v", ea, eb)
	}
}

func TestResync(t *testing.T) {
	h := NewHub(10)
	c := &recClient{}
	h.Add(c)
	h.Broadcast("tasks") // seq -> 1

	// stale client: lastEventID "0" < 1 -> resync emitted (seq -> 2)
	h.Resync(c, "0")
	ev := c.snapshot()
	if len(ev) != 2 {
		t.Fatalf("expected 2 events, got %d", len(ev))
	}
	if ev[1].Event != "sync.resync" || ev[1].Data != `{"type":"changed","entity":"*"}` {
		t.Fatalf("resync event wrong: %+v", ev[1])
	}

	// up-to-date client: lastEventID == seq -> no resync
	n := len(c.snapshot())
	h.Resync(c, "2")
	if got := len(c.snapshot()); got != n {
		t.Fatalf("no resync expected when up-to-date, got %d events", got)
	}

	// non-numeric lastEventID -> no resync
	h.Resync(c, "garbage")
	if got := len(c.snapshot()); got != n {
		t.Fatalf("no resync expected on non-numeric id")
	}
}

func TestShutdown(t *testing.T) {
	h := NewHub(10)
	c := &recClient{}
	h.Add(c)
	h.Shutdown()
	ev := c.snapshot()
	if len(ev) != 1 || ev[0].Event != "shutdown" || ev[0].Data != "{}" || ev[0].ID != "" {
		t.Fatalf("shutdown event wrong: %+v", ev)
	}
	if h.Size() != 0 {
		t.Fatalf("shutdown must clear clients, size=%d", h.Size())
	}
}

func TestDropClientOnWriteError(t *testing.T) {
	h := NewHub(10)
	ok := &recClient{}
	bad := &recClient{err: errFake}
	h.Add(ok)
	h.Add(bad)
	h.Broadcast("tasks")
	if h.Size() != 1 {
		t.Fatalf("failing client must be dropped, size=%d", h.Size())
	}
	if len(ok.snapshot()) != 1 {
		t.Fatalf("healthy client must still receive events")
	}
}

func TestWriteEventFormat(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteEvent(&buf, "1", "hello", `{"ok":true}`); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if got != "id: 1\nevent: hello\ndata: {\"ok\":true}\n\n" {
		t.Fatalf("unexpected SSE framing: %q", got)
	}
	// no id (shutdown)
	buf.Reset()
	if err := WriteEvent(&buf, "", "shutdown", "{}"); err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(buf.String(), "id:") {
		t.Fatalf("shutdown framing must not include id: %q", buf.String())
	}
}

var errFake = &fakeErr{}

type fakeErr struct{}

func (f *fakeErr) Error() string { return "write failed" }
