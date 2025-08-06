#!/bin/bash

# Simple auto-commit hook for task completion

# Check for changes
if git diff --quiet && git diff --staged --quiet; then
    echo "No changes to commit"
    exit 0
fi

# Stage and commit changes
git add -A
git commit -m "🤖 task completed: $(date '+%Y-%m-%d %H:%M:%S')

🔧 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

echo "✅ Task completion committed successfully"