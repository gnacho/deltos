package errors

import (
	"encoding/json"
	"net/http"
)

// HTTPError is a domain error: handlers return it, the router middleware
// serializes the envelope (equivalent of httpError() + onError in errors.ts).
type HTTPError struct {
	Status  int
	Code    Code
	Details any
}

func (e *HTTPError) Error() string { return string(e.Code) }

// New builds a domain error (equivalent of httpError(status, code, details)).
func New(status int, code Code) *HTTPError { return &HTTPError{Status: status, Code: code} }

// WithDetails attaches details (e.g. validation issues).
func (e *HTTPError) WithDetails(details any) *HTTPError {
	e.Details = details
	return e
}

type envelopeBody struct {
	Error envelopeError `json:"error"`
}

type envelopeError struct {
	Code    Code   `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// Envelope builds the JSON body for a code (details omitted when nil).
func Envelope(code Code, details any) envelopeBody {
	return envelopeBody{Error: envelopeError{Code: code, Message: Message(code), Details: details}}
}

// Write serializes an HTTPError as the single error envelope. Every 4xx/5xx
// of the API must go through here (or the router recovery), never hand-built.
func Write(w http.ResponseWriter, e *HTTPError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(Envelope(e.Code, e.Details))
}

// FromErr converts any error: HTTPError passthrough, otherwise 500
// INTERNAL_ERROR (the stack goes to the log, never to the client).
func FromErr(err error) *HTTPError {
	if err == nil {
		return nil
	}
	if he, ok := err.(*HTTPError); ok {
		return he
	}
	return &HTTPError{Status: http.StatusInternalServerError, Code: InternalError}
}
