#!/bin/bash

# Task completion notification hook
# Activates CLI window and shows completion dialog

# Get the terminal process to activate
TERMINAL_APP=$(ps -p $PPID -o comm= | tr -d ' ')

# Function to get the last completed task description
get_last_task() {
    # Try to extract task info from recent commit messages
    LAST_COMMIT_MSG=$(git log -1 --pretty=format:"%s" 2>/dev/null)
    
    # If we can extract task info from commit message
    if [[ "$LAST_COMMIT_MSG" == *"task completed"* ]]; then
        echo "任务"
    else
        # Default fallback
        echo "任务"
    fi
}

# Function to show notification dialog
show_notification() {
    local task_name="$1"
    
    # Use AppleScript to show dialog and activate terminal
    osascript << EOF
        -- Activate the terminal application
        tell application "Terminal"
            activate
        end tell
        
        -- Show completion dialog
        display dialog "主人，您的${task_name}已经完成！ 🎉" \\
            with title "Claude Code - 任务完成通知" \\
            with icon note \\
            buttons {"继续工作", "查看详情"} \\
            default button "继续工作" \\
            giving up after 10
        
        set dialogResult to result
        
        -- If user clicks "查看详情", open git log
        if button returned of dialogResult is "查看详情" then
            tell application "Terminal"
                do script "git log --oneline -5"
            end tell
        end if
EOF
}

# Function to send system notification (fallback)
send_system_notification() {
    local task_name="$1"
    
    osascript -e "display notification \"主人，您的${task_name}已经完成！\" with title \"Claude Code\" sound name \"Glass\""
}

# Function to activate terminal window
activate_terminal() {
    # Try different methods to activate terminal
    if command -v osascript >/dev/null 2>&1; then
        # For macOS - activate Terminal or iTerm2
        osascript << EOF
            try
                tell application "Terminal" to activate
            on error
                try
                    tell application "iTerm2" to activate
                on error
                    try
                        tell application "iTerm" to activate
                    end try
                end try
            end try
EOF
    fi
    
    # Also try to bring current terminal to front
    if [[ "$TERM_PROGRAM" == "Apple_Terminal" ]]; then
        osascript -e 'tell application "Terminal" to set frontmost to true'
    elif [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
        osascript -e 'tell application "iTerm2" to activate'
    fi
}

# Main execution
main() {
    local task_name=$(get_last_task)
    
    echo "🔔 显示任务完成通知..."
    
    # Activate terminal window first
    activate_terminal
    
    # Show notification dialog
    if command -v osascript >/dev/null 2>&1; then
        show_notification "$task_name"
    else
        # Fallback for non-macOS systems
        echo "🎉 主人，您的${task_name}已经完成！"
        
        # Try to use notify-send on Linux
        if command -v notify-send >/dev/null 2>&1; then
            notify-send "Claude Code - 任务完成" "主人，您的${task_name}已经完成！"
        fi
    fi
    
    echo "✅ 通知已发送"
}

# Execute main function
main "$@"