#!/bin/bash

# Start script for Profile Analytics Service
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    print_status "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
print_status "Activating virtual environment..."
source venv/bin/activate

# Check if requirements are installed
if [ ! -f "venv/requirements_installed.flag" ]; then
    print_status "Installing dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt
    touch venv/requirements_installed.flag
else
    print_status "Dependencies already installed. Checking for updates..."
    pip install -r requirements.txt --upgrade-strategy only-if-needed
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        print_warning "No .env file found. Copying from .env.example..."
        cp .env.example .env
        print_warning "Please edit .env file with your actual configuration!"
    else
        print_error "No .env or .env.example file found!"
        exit 1
    fi
fi

# Create necessary directories
print_status "Creating necessary directories..."
mkdir -p ml/models ml/features logs

# Check database connectivity (optional)
check_database() {
    print_status "Checking database connectivity..."
    python -c "
import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from dotenv import load_dotenv

load_dotenv()

async def check_db():
    try:
        engine = create_async_engine(os.getenv('DATABASE_URL'))
        async with engine.begin() as conn:
            await conn.execute('SELECT 1')
        await engine.dispose()
        print('Database connection: OK')
        return True
    except Exception as e:
        print(f'Database connection failed: {e}')
        return False

result = asyncio.run(check_db())
exit(0 if result else 1)
    " && print_status "Database connection successful" || print_warning "Database connection failed - service will attempt to connect on startup"
}

# Check Redis connectivity (optional)
check_redis() {
    print_status "Checking Redis connectivity..."
    python -c "
import os
import redis
from dotenv import load_dotenv

load_dotenv()

try:
    r = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))
    r.ping()
    print('Redis connection: OK')
    exit(0)
except Exception as e:
    print(f'Redis connection failed: {e}')
    exit(1)
    " && print_status "Redis connection successful" || print_warning "Redis connection failed - service will attempt to connect on startup"
}

# Run connectivity checks if requested
if [ "$1" = "--check-deps" ]; then
    check_database
    check_redis
fi

# Set Python path
export PYTHONPATH="${PWD}:${PYTHONPATH}"

# Start the service
print_status "Starting Profile Analytics Service..."

# Choose startup mode
if [ "$1" = "--dev" ] || [ "${ENVIRONMENT}" = "development" ]; then
    print_status "Starting in development mode with auto-reload..."
    python -m uvicorn main:app \
        --host 0.0.0.0 \
        --port ${PORT:-3004} \
        --reload \
        --log-level info \
        --access-log
elif [ "$1" = "--prod" ]; then
    print_status "Starting in production mode..."
    python -m uvicorn main:app \
        --host 0.0.0.0 \
        --port ${PORT:-3004} \
        --workers ${WORKERS:-2} \
        --log-level warning \
        --no-access-log
else
    # Default startup
    print_status "Starting with default configuration..."
    python main.py
fi