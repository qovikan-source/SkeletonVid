# Makefile for SkeletonVid Pro Cross-Platform Companion
BINARY_NAME=SkeletonVid-host
DIST_DIR=../dist

.PHONY: all clean windows darwin linux

all: clean windows darwin linux

windows:
	@mkdir -p $(DIST_DIR)
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o $(DIST_DIR)/$(BINARY_NAME)-windows-amd64.exe .

darwin:
	@mkdir -p $(DIST_DIR)
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o $(DIST_DIR)/$(BINARY_NAME)-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o $(DIST_DIR)/$(BINARY_NAME)-darwin-arm64 .
	lipo -create -output $(DIST_DIR)/$(BINARY_NAME)-darwin-universal $(DIST_DIR)/$(BINARY_NAME)-darwin-amd64 $(DIST_DIR)/$(BINARY_NAME)-darwin-arm64 || cp $(DIST_DIR)/$(BINARY_NAME)-darwin-arm64 $(DIST_DIR)/$(BINARY_NAME)-darwin-universal
	@rm -f $(DIST_DIR)/$(BINARY_NAME)-darwin-amd64 $(DIST_DIR)/$(BINARY_NAME)-darwin-arm64

linux:
	@mkdir -p $(DIST_DIR)
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $(DIST_DIR)/$(BINARY_NAME)-linux-amd64 .

clean:
	@rm -rf $(DIST_DIR)
