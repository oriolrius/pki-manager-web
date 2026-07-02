# krl-client — host-side SSH KRL puller. Mirrors k8s/issuer/Makefile.
VERSION ?= dev
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build build-static test vet fmt tidy clean

build:
	go build -ldflags '$(LDFLAGS)' -o dist/krl-client .

# Single static linux/amd64 release artifact (KRLC-12 CI builds this).
build-static:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/krl-client-linux-amd64 .

test:
	go test ./... -race -covermode=atomic -coverprofile=coverage.out -count=1

vet:
	go vet ./...

fmt:
	gofmt -w .

tidy:
	go mod tidy

clean:
	rm -rf dist coverage.out
