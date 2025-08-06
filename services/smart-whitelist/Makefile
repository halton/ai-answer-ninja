# Smart Whitelist Service Makefile

.PHONY: help build run test clean docker-build docker-run deps lint fmt vet coverage benchmark

# Variables
SERVICE_NAME := smart-whitelist
DOCKER_IMAGE := $(SERVICE_NAME):latest
MAIN_PATH := ./cmd/main.go
BUILD_DIR := ./bin
COVERAGE_FILE := coverage.out

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Development
run: ## Run the service locally
	@echo "Starting $(SERVICE_NAME)..."
	go run $(MAIN_PATH)

dev: ## Run with development settings
	@echo "Starting $(SERVICE_NAME) in development mode..."
	SMART_WHITELIST_LOGGING_LEVEL=debug \
	SMART_WHITELIST_LOGGING_DEVELOPMENT=true \
	go run $(MAIN_PATH)

# Build
build: clean ## Build the service binary
	@echo "Building $(SERVICE_NAME)..."
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
		-ldflags='-w -s -extldflags "-static"' \
		-a -installsuffix cgo \
		-o $(BUILD_DIR)/$(SERVICE_NAME) \
		$(MAIN_PATH)

build-local: clean ## Build for local development
	@echo "Building $(SERVICE_NAME) for local development..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(SERVICE_NAME) $(MAIN_PATH)

# Testing
test: ## Run tests
	@echo "Running tests..."
	go test -v ./...

test-short: ## Run short tests only
	@echo "Running short tests..."
	go test -short -v ./...

test-race: ## Run tests with race detector
	@echo "Running tests with race detector..."
	go test -race -v ./...

coverage: ## Run tests with coverage
	@echo "Running tests with coverage..."
	go test -coverprofile=$(COVERAGE_FILE) ./...
	go tool cover -html=$(COVERAGE_FILE) -o coverage.html
	@echo "Coverage report generated: coverage.html"

benchmark: ## Run benchmarks
	@echo "Running benchmarks..."
	go test -bench=. -benchmem ./...

# Code quality
lint: ## Run linter
	@if command -v golangci-lint >/dev/null 2>&1; then \
		echo "Running golangci-lint..."; \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed. Install with: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest"; \
	fi

fmt: ## Format code
	@echo "Formatting code..."
	go fmt ./...

vet: ## Run go vet
	@echo "Running go vet..."
	go vet ./...

# Dependencies
deps: ## Install dependencies
	@echo "Installing dependencies..."
	go mod download
	go mod tidy

deps-update: ## Update dependencies
	@echo "Updating dependencies..."
	go get -u ./...
	go mod tidy

# Docker
docker-build: ## Build Docker image
	@echo "Building Docker image $(DOCKER_IMAGE)..."
	docker build -t $(DOCKER_IMAGE) .

docker-run: ## Run Docker container
	@echo "Running Docker container..."
	docker run -p 3006:3006 --rm $(DOCKER_IMAGE)

docker-dev: ## Run with Docker Compose in development mode
	@echo "Starting services with Docker Compose..."
	docker-compose --profile debug up --build

docker-prod: ## Run with Docker Compose in production mode
	@echo "Starting services with Docker Compose (production)..."
	docker-compose up --build smart-whitelist postgres redis

docker-stop: ## Stop Docker Compose services
	@echo "Stopping Docker Compose services..."
	docker-compose down

docker-clean: ## Clean Docker resources
	@echo "Cleaning Docker resources..."
	docker-compose down -v --remove-orphans
	docker image prune -f

# Database
db-migrate: ## Run database migrations (if applicable)
	@echo "Running database migrations..."
	# Add migration commands here when available

db-seed: ## Seed database with test data
	@echo "Seeding database with test data..."
	# Add seeding commands here when available

# Monitoring
metrics: ## Show metrics endpoint
	@echo "Metrics available at: http://localhost:3006/metrics"
	curl -s http://localhost:3006/metrics | head -20

health: ## Check service health
	@echo "Checking service health..."
	@curl -s http://localhost:3006/health | jq .
	@echo ""
	@curl -s http://localhost:3006/health/ready | jq .

# Performance testing
load-test: ## Run basic load test (requires wrk)
	@if command -v wrk >/dev/null 2>&1; then \
		echo "Running load test..."; \
		wrk -t12 -c400 -d30s http://localhost:3006/health; \
	else \
		echo "wrk not installed. Install from: https://github.com/wg/wrk"; \
	fi

# Cleanup
clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	rm -f $(COVERAGE_FILE) coverage.html

clean-all: clean docker-clean ## Clean everything including Docker resources

# Tools installation
install-tools: ## Install development tools
	@echo "Installing development tools..."
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	go install github.com/swaggo/swag/cmd/swag@latest

# Generate (for future use)
generate: ## Run go generate
	@echo "Running go generate..."
	go generate ./...

# Security
security-scan: ## Run security scan (requires gosec)
	@if command -v gosec >/dev/null 2>&1; then \
		echo "Running security scan..."; \
		gosec ./...; \
	else \
		echo "gosec not installed. Install with: go install github.com/securecodewarrior/gosec/v2/cmd/gosec@latest"; \
	fi

# Release (for CI/CD)
release: clean test lint build ## Prepare release build
	@echo "Release build completed: $(BUILD_DIR)/$(SERVICE_NAME)"

# Development environment
env-check: ## Check development environment
	@echo "Checking development environment..."
	@echo "Go version: $(shell go version)"
	@echo "Docker version: $(shell docker --version 2>/dev/null || echo 'Docker not installed')"
	@echo "Docker Compose version: $(shell docker-compose --version 2>/dev/null || echo 'Docker Compose not installed')"
	@echo "Git version: $(shell git --version 2>/dev/null || echo 'Git not installed')"

# Show service info
info: ## Show service information
	@echo "Service: $(SERVICE_NAME)"
	@echo "Main: $(MAIN_PATH)"
	@echo "Build dir: $(BUILD_DIR)"
	@echo "Docker image: $(DOCKER_IMAGE)"
	@echo "Ports: 3006 (HTTP)"
	@echo ""
	@echo "API Endpoints:"
	@echo "  Health: http://localhost:3006/health"
	@echo "  Metrics: http://localhost:3006/metrics"
	@echo "  API: http://localhost:3006/api/v1/"