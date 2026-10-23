// Package logger provides a small structured JSON logger with child loggers
// and levels, functionally equivalent to the pino logger used by the Node
// server (one JSON object per line: time, level, event, fields).
package logger

import (
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

type Level int

const (
	Debug Level = iota
	Info
	Warn
	Error
)

func (l Level) String() string {
	switch l {
	case Debug:
		return "debug"
	case Info:
		return "info"
	case Warn:
		return "warn"
	case Error:
		return "error"
	}
	return "info"
}

// Logger writes JSON lines. Safe for concurrent use.
type Logger struct {
	mu       *sync.Mutex
	out      io.Writer
	min      Level
	fields   map[string]any
	nowFn    func() time.Time
	outputFn func(io.Writer, []byte) // hook for tests
}

var root = &Logger{
	mu:     &sync.Mutex{},
	out:    os.Stderr,
	min:    fromEnvLevel(),
	fields: map[string]any{},
	nowFn:  time.Now,
}

func fromEnvLevel() Level {
	switch os.Getenv("LOG_LEVEL") {
	case "debug":
		return Debug
	case "warn":
		return Warn
	case "error":
		return Error
	default:
		return Info
	}
}

// L is the application-wide root logger.
func L() *Logger { return root }

// Child returns a logger that always includes the given fields (e.g.
// component=db), mirroring logger.child({component}) in the Node server.
func (l *Logger) Child(fields map[string]any) *Logger {
	merged := make(map[string]any, len(l.fields)+len(fields))
	for k, v := range l.fields {
		merged[k] = v
	}
	for k, v := range fields {
		merged[k] = v
	}
	return &Logger{mu: l.mu, out: l.out, min: l.min, fields: merged, nowFn: l.nowFn, outputFn: l.outputFn}
}

// SetOutput redirects the root logger (tests).
func SetOutput(w io.Writer) { root.out = w }

// SetLevel sets the minimum level of the root logger (tests).
func SetLevel(l Level) { root.min = l }

func (l *Logger) log(level Level, event string, kv []any) {
	if level < l.min {
		return
	}
	entry := make(map[string]any, len(l.fields)+len(kv)/2+3)
	for k, v := range l.fields {
		entry[k] = v
	}
	for i := 0; i+1 < len(kv); i += 2 {
		if k, ok := kv[i].(string); ok {
			entry[k] = kv[i+1]
		}
	}
	entry["time"] = l.nowFn().UTC().Format(time.RFC3339Nano)
	entry["level"] = level.String()
	entry["event"] = event
	b, err := json.Marshal(entry)
	if err != nil {
		return
	}
	b = append(b, '\n')
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.outputFn != nil {
		l.outputFn(l.out, b)
		return
	}
	_, _ = l.out.Write(b)
}

func (l *Logger) Debug(event string, kv ...any) { l.log(Debug, event, kv) }
func (l *Logger) Info(event string, kv ...any)  { l.log(Info, event, kv) }
func (l *Logger) Warn(event string, kv ...any)  { l.log(Warn, event, kv) }
func (l *Logger) Error(event string, kv ...any) { l.log(Error, event, kv) }
