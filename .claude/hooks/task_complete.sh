#!/bin/bash

# Auto-commit hook for task completion
# This script runs after each successful task completion

# Get current timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Get the last task that was completed (you may need to customize this)
LAST_TASK_DESC="Task completed"

# Check if there are any changes to commit
if git diff --quiet && git diff --staged --quiet; then
    echo "ℹ️  No changes detected, skipping commit"
    exit 0
fi

# Stage all relevant files (excluding node_modules, logs, etc.)
echo "📁 Staging changes..."
git add \
    "*.md" \
    "*.js" \
    "*.ts" \
    "*.json" \
    "*.yaml" \
    "*.yml" \
    "*.go" \
    "*.py" \
    "*.sql" \
    "*.sh" \
    "*.conf" \
    "Dockerfile*" \
    "docker-compose*" \
    "Makefile" \
    "README*" \
    "CLAUDE.md" \
    2>/dev/null || true

# Check again if there are staged changes
if git diff --staged --quiet; then
    echo "ℹ️  No relevant changes to commit"
    exit 0
fi

# Create commit message
COMMIT_MSG="🤖 feat: ${LAST_TASK_DESC}

Auto-generated commit after task completion
Generated at: ${TIMESTAMP}

🔧 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Commit the changes
echo "💾 Committing changes..."
git commit -m "$COMMIT_MSG"

if [ $? -eq 0 ]; then
    echo "✅ Successfully committed task completion"
    
    # Show brief summary of what was committed
    echo ""
    echo "📋 Commit summary:"
    git log -1 --stat --pretty=format:"  Hash: %h%n  Date: %cd%n  Files changed: " --date=format:'%Y-%m-%d %H:%M:%S'
    git diff --name-only HEAD~1 HEAD | sed 's/^/    /'
    
else
    echo "❌ Failed to commit changes"
    exit 1
fi