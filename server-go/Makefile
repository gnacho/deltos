# Deltos server-go build (phase 1). Static binary: pure Go sqlite driver.
SHELL := /bin/bash
VERSION := $(shell sed -n 's/.*"version": "\([^"]*\)".*/\1/p' ../server/package.json | head -1)
BIN := deltos-go

.PHONY: build static test vet lint tidy clean

build: 
	go build ./...

static: 
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X github.com/gnacho/deltos/server-go/internal/version.Version=$(VERSION)" -o $(BIN) ./cmd/server

test:
	go test ./... -race

vet:
	go vet ./...

lint: vet
	staticcheck ./...

tidy:
	go mod tidy

clean:
	rm -f $(BIN)
