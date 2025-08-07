#!/bin/bash

# Conversation Analyzer Service Startup Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
SERVICE_NAME=${SERVICE_NAME:-conversation-analyzer}
SERVICE_PORT=${SERVICE_PORT:-3010}
SERVICE_HOST=${SERVICE_HOST:-0.0.0.0}
LOG_LEVEL=${LOG_LEVEL:-INFO}
DEBUG=${DEBUG:-false}

# Environment check
ENVIRONMENT=${ENVIRONMENT:-development}

echo -e "${BLUE}Starting ${SERVICE_NAME} service...${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Port: ${SERVICE_PORT}${NC}"
echo -e "${BLUE}Log Level: ${LOG_LEVEL}${NC}"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check environment variables
check_env_vars() {
    echo -e "${BLUE}Checking environment variables...${NC}"
    
    local required_vars=(
        "DATABASE_URL"
        "REDIS_URL"
        "AZURE_SPEECH_KEY"
        "AZURE_SPEECH_REGION"
        "AZURE_OPENAI_ENDPOINT"
        "AZURE_OPENAI_API_KEY"
        "SECRET_KEY"
    )
    
    local missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        echo -e "${RED}Missing required environment variables:${NC}"
        printf '%s\n' "${missing_vars[@]}"
        echo -e "${YELLOW}Please set these variables before starting the service.${NC}"
        return 1
    fi
    
    echo -e "${GREEN}All required environment variables are set.${NC}"
    return 0
}

# Function to check dependencies
check_dependencies() {
    echo -e "${BLUE}Checking dependencies...${NC}"
    
    if ! command_exists python; then
        echo -e "${RED}Python is not installed.${NC}"
        exit 1
    fi
    
    local python_version=$(python --version 2>&1 | awk '{print $2}')
    echo -e "${GREEN}Python version: ${python_version}${NC}"
    
    # Check if virtual environment is activated
    if [[ -z "${VIRTUAL_ENV}" ]]; then
        echo -e "${YELLOW}Virtual environment not detected. Consider using venv.${NC}"
    else
        echo -e "${GREEN}Virtual environment: ${VIRTUAL_ENV}${NC}"
    fi
}

# Function to install dependencies
install_dependencies() {
    echo -e "${BLUE}Installing dependencies...${NC}"
    
    if [[ -f "requirements.txt" ]]; then
        pip install -r requirements.txt
        echo -e "${GREEN}Dependencies installed successfully.${NC}"
    else
        echo -e "${YELLOW}requirements.txt not found. Skipping dependency installation.${NC}"
    fi
    
    # Install spaCy models
    echo -e "${BLUE}Installing spaCy models...${NC}"
    python -m spacy download zh_core_web_sm || {
        echo -e "${YELLOW}Chinese model not available, falling back to English...${NC}"
        python -m spacy download en_core_web_sm || {
            echo -e "${RED}Failed to install spaCy models. Some features may not work.${NC}"
        }
    }
}

# Function to check external services
check_external_services() {
    echo -e "${BLUE}Checking external services...${NC}"
    
    # Check database connection
    if [[ -n "${DATABASE_URL}" ]]; then
        echo -e "${BLUE}Testing database connection...${NC}"
        python -c "
import asyncio
import asyncpg
import sys
import os

async def test_db():
    try:
        conn = await asyncpg.connect('${DATABASE_URL}')
        await conn.execute('SELECT 1')
        await conn.close()
        print('✓ Database connection successful')
        return True
    except Exception as e:
        print(f'✗ Database connection failed: {e}')
        return False

result = asyncio.run(test_db())
sys.exit(0 if result else 1)
        " || echo -e "${YELLOW}Database connection failed. Service may not start properly.${NC}"
    fi
    
    # Check Redis connection
    if [[ -n "${REDIS_URL}" ]]; then
        echo -e "${BLUE}Testing Redis connection...${NC}"
        python -c "
import redis
import sys
import os

try:
    r = redis.from_url('${REDIS_URL}')
    r.ping()
    print('✓ Redis connection successful')
except Exception as e:
    print(f'✗ Redis connection failed: {e}')
    sys.exit(1)
        " || echo -e "${YELLOW}Redis connection failed. Service may not start properly.${NC}"
    fi
}

# Function to create necessary directories
create_directories() {
    echo -e "${BLUE}Creating necessary directories...${NC}"
    
    local dirs=(
        "logs"
        "cache"
        "cache/huggingface"
    )
    
    for dir in "${dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            mkdir -p "$dir"
            echo -e "${GREEN}Created directory: ${dir}${NC}"
        fi
    done
}

# Function to start the service
start_service() {
    echo -e "${BLUE}Starting ${SERVICE_NAME} service...${NC}"
    
    local cmd="python -m uvicorn app.main:app"
    cmd="${cmd} --host ${SERVICE_HOST}"
    cmd="${cmd} --port ${SERVICE_PORT}"
    cmd="${cmd} --log-level ${LOG_LEVEL,,}"
    
    if [[ "${DEBUG}" == "true" ]]; then
        cmd="${cmd} --reload"
        echo -e "${YELLOW}Debug mode enabled. Auto-reload is active.${NC}"
    fi
    
    if [[ "${ENVIRONMENT}" == "production" ]]; then
        # Production settings
        cmd="${cmd} --workers 4"
        echo -e "${GREEN}Production mode: Using 4 workers${NC}"
    fi
    
    echo -e "${GREEN}Starting command: ${cmd}${NC}"
    echo -e "${GREEN}Service will be available at: http://${SERVICE_HOST}:${SERVICE_PORT}${NC}"
    echo -e "${GREEN}Health check: http://${SERVICE_HOST}:${SERVICE_PORT}/health${NC}"
    echo -e "${GREEN}API docs: http://${SERVICE_HOST}:${SERVICE_PORT}/docs${NC}"
    echo ""
    
    exec $cmd
}

# Function to run pre-flight checks
run_preflight_checks() {
    echo -e "${BLUE}Running pre-flight checks...${NC}"
    
    check_dependencies
    
    if [[ "${SKIP_ENV_CHECK}" != "true" ]]; then
        check_env_vars || {
            echo -e "${RED}Pre-flight checks failed. Set SKIP_ENV_CHECK=true to bypass.${NC}"
            exit 1
        }
    fi
    
    if [[ "${SKIP_SERVICE_CHECK}" != "true" ]]; then
        check_external_services
    fi
    
    create_directories
    
    echo -e "${GREEN}Pre-flight checks completed.${NC}"
}

# Function to show help
show_help() {
    cat << EOF
Conversation Analyzer Service Startup Script

Usage: $0 [OPTIONS]

Options:
    --help              Show this help message
    --install-deps      Install dependencies only
    --check-deps        Check dependencies only
    --skip-checks       Skip all pre-flight checks
    --dev               Start in development mode
    --prod              Start in production mode

Environment Variables:
    SERVICE_NAME        Service name (default: conversation-analyzer)
    SERVICE_PORT        Port to listen on (default: 3010)
    SERVICE_HOST        Host to bind to (default: 0.0.0.0)
    LOG_LEVEL          Log level (default: INFO)
    DEBUG              Enable debug mode (default: false)
    ENVIRONMENT        Environment (development/production)
    
    SKIP_ENV_CHECK     Skip environment variable checks
    SKIP_SERVICE_CHECK Skip external service checks

Required Environment Variables:
    DATABASE_URL       PostgreSQL connection string
    REDIS_URL          Redis connection string
    AZURE_SPEECH_KEY   Azure Speech Services key
    AZURE_SPEECH_REGION Azure region
    AZURE_OPENAI_ENDPOINT Azure OpenAI endpoint
    AZURE_OPENAI_API_KEY Azure OpenAI API key
    SECRET_KEY         Service secret key

Examples:
    $0                  # Start service with default settings
    $0 --dev           # Start in development mode
    $0 --prod          # Start in production mode
    $0 --install-deps  # Install dependencies only
    $0 --skip-checks   # Skip pre-flight checks
    
EOF
}

# Main execution
main() {
    local skip_checks=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help)
                show_help
                exit 0
                ;;
            --install-deps)
                install_dependencies
                exit 0
                ;;
            --check-deps)
                check_dependencies
                exit 0
                ;;
            --skip-checks)
                skip_checks=true
                shift
                ;;
            --dev)
                export ENVIRONMENT=development
                export DEBUG=true
                export LOG_LEVEL=DEBUG
                shift
                ;;
            --prod)
                export ENVIRONMENT=production
                export DEBUG=false
                export LOG_LEVEL=INFO
                shift
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Run pre-flight checks unless skipped
    if [[ "$skip_checks" != "true" ]]; then
        run_preflight_checks
    fi
    
    # Start the service
    start_service
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${YELLOW}Service interrupted. Shutting down...${NC}"; exit 0' INT

# Run main function
main "$@"