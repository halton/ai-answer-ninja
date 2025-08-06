#!/bin/bash

# Smart auto-commit hook for task completion

# Check for changes
if git diff --quiet && git diff --staged --quiet; then
    echo "No changes to commit"
    exit 0
fi

# Smart selective staging - only include relevant files
echo "📁 Staging relevant changes..."
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
    ".claude/**" \
    "config/**" \
    "scripts/**" \
    "k8s/**" \
    "helm/**" \
    "database/**" \
    "docs/**" \
    2>/dev/null || true

# Exclude unwanted files/directories
git reset HEAD -- node_modules/ 2>/dev/null || true
git reset HEAD -- "*/node_modules/*" 2>/dev/null || true
git reset HEAD -- "*.log" 2>/dev/null || true
git reset HEAD -- "tmp/" 2>/dev/null || true

# Check if there are actually staged changes
if git diff --staged --quiet; then
    echo "ℹ️  No relevant changes to commit"
    exit 0
fi

# Commit the changes
git commit -m "🤖 task completed: $(date '+%Y-%m-%d %H:%M:%S')

🔧 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

if [ $? -eq 0 ]; then
    echo "✅ Task completion committed successfully"
    
    # Show brief summary
    echo ""
    echo "📋 Changes committed:"
    git diff --name-only HEAD~1 HEAD | head -10 | sed 's/^/  📄 /'
    
    CHANGED_COUNT=$(git diff --name-only HEAD~1 HEAD | wc -l)
    if [ $CHANGED_COUNT -gt 10 ]; then
        echo "  ... and $(($CHANGED_COUNT - 10)) more files"
    fi
else
    echo "❌ Failed to commit changes"
    exit 1
fi