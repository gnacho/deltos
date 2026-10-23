// Package keyset ports server/src/pagination.ts: opaque base64url cursor
// {ts,id} and the LIMIT n+1 page trick over rows ordered by
// (created_at DESC, id DESC).
package keyset

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/gnacho/deltos/server-go/internal/errors"
)

// Cursor is the opaque cursor: ts = created_at (epoch ms) of the last row,
// id = tie-breaker for equal timestamps.
type Cursor struct {
	TS int64  `json:"ts"`
	ID string `json:"id"`
}

// EncodeCursor serializes a cursor to base64url (no padding), matching the
// Node Buffer.toString('base64url').
func EncodeCursor(c Cursor) string {
	b, err := json.Marshal(c)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor parses a base64url cursor. Malformed input returns a
// 400 INVALID_CURSOR HTTPError (never silently page 1: the UI would show
// duplicates).
func DecodeCursor(raw string) (Cursor, *errors.HTTPError) {
	invalid := errors.New(http.StatusBadRequest, errors.InvalidCursor)
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return Cursor{}, invalid
	}
	var parsed struct {
		TS *int64 `json:"ts"`
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return Cursor{}, invalid
	}
	if parsed.TS == nil || parsed.ID == "" {
		return Cursor{}, invalid
	}
	return Cursor{TS: *parsed.TS, ID: parsed.ID}, nil
}

// Row is the minimum a paginated row needs to build a cursor.
type Row interface {
	GetCreatedAt() int64
	GetID() string
}

// Page applies the LIMIT n+1 trick. rows must be ordered by
// (created_at DESC, id DESC) and filtered by the keyset when a cursor was
// supplied. Returns the truncated items, hasMore and the next cursor.
func Page[T Row](rows []T, limit int) (items []T, hasMore bool, nextCursor string) {
	hasMore = len(rows) > limit
	if hasMore {
		items = rows[:limit]
	} else {
		items = rows
	}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		nextCursor = EncodeCursor(Cursor{TS: last.GetCreatedAt(), ID: last.GetID()})
	}
	return items, hasMore, nextCursor
}
