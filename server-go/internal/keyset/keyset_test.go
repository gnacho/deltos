package keyset

import (
	"encoding/base64"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/errors"
)

func b64(s string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}

type row struct {
	createdAt int64
	id        string
}

func (r row) GetCreatedAt() int64 { return r.createdAt }
func (r row) GetID() string       { return r.id }

func TestRoundTrip(t *testing.T) {
	orig := Cursor{TS: 1700000000000, ID: "abc-def"}
	enc := EncodeCursor(orig)
	if enc == "" {
		t.Fatal("encode produced empty cursor")
	}
	dec, herr := DecodeCursor(enc)
	if herr != nil {
		t.Fatalf("decode failed: %v", herr)
	}
	if dec != orig {
		t.Fatalf("round trip mismatch: %+v != %+v", dec, orig)
	}
}

func TestDecodeMalformed(t *testing.T) {
	cases := []string{
		"not base64 at all !!!",
		"",                                  // empty -> empty JSON? base64 of "" is "", decode -> empty buffer -> unmarshal error
		EncodeCursor(Cursor{TS: 0, ID: ""}), // valid base64, id empty
	}
	for _, raw := range cases {
		_, herr := DecodeCursor(raw)
		if herr == nil {
			t.Fatalf("expected error for %q", raw)
		}
		if herr.Status != 400 || herr.Code != errors.InvalidCursor {
			t.Fatalf("expected 400 INVALID_CURSOR, got %d %s", herr.Status, herr.Code)
		}
	}
	// extra malformed shapes (valid base64url, wrong JSON shape)
	for _, jsonStr := range []string{"null", "[]", "123", `"str"`, "{}", `{"ts":123}`, `{"ts":"x","id":"a"}`, `{"id":"a"}`} {
		enc := b64(jsonStr)
		if _, herr := DecodeCursor(enc); herr == nil {
			t.Fatalf("expected error for JSON %q", jsonStr)
		}
	}
}

func TestPageHasMoreAndNextCursor(t *testing.T) {
	mk := func(ts int64, id string) row { return row{createdAt: ts, id: id} }

	// fewer than limit: no more, no cursor
	rows := []row{mk(3, "c"), mk(2, "b")}
	items, hasMore, next := Page(rows, 2)
	if hasMore || next != "" || len(items) != 2 {
		t.Fatalf("exact limit: hasMore=%v next=%q items=%d", hasMore, next, len(items))
	}

	// limit n+1: hasMore true, next cursor from last delivered item
	rows = []row{mk(3, "c"), mk(2, "b"), mk(1, "a")}
	items, hasMore, next = Page(rows, 2)
	if !hasMore || len(items) != 2 || items[1].id != "b" {
		t.Fatalf("hasMore=%v items=%d", hasMore, len(items))
	}
	want := EncodeCursor(Cursor{TS: 2, ID: "b"})
	if next != want {
		t.Fatalf("next cursor = %q, want %q", next, want)
	}

	// no rows
	items, hasMore, next = Page([]row{}, 2)
	if hasMore || next != "" || len(items) != 0 {
		t.Fatalf("empty page wrong")
	}
}
