#!/bin/bash

# Simple and reliable task completion notification

# Function to extract task description
get_task_description() {
    local task_desc="任务"
    
    # Look for recently modified files to infer task type
    RECENT_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -5)
    
    if echo "$RECENT_FILES" | grep -q "\.md$"; then
        task_desc="文档任务"
    elif echo "$RECENT_FILES" | grep -q "\.ts$\|\.js$"; then
        task_desc="代码开发任务"
    elif echo "$RECENT_FILES" | grep -q "\.go$"; then
        task_desc="Go服务开发任务"
    elif echo "$RECENT_FILES" | grep -q "\.py$"; then
        task_desc="Python开发任务"
    elif echo "$RECENT_FILES" | grep -q "docker-compose\|Dockerfile"; then
        task_desc="容器配置任务"
    elif echo "$RECENT_FILES" | grep -q "\.yaml$\|\.yml$"; then
        task_desc="配置文件任务"
    elif echo "$RECENT_FILES" | grep -q "\.sql$"; then
        task_desc="数据库任务"
    elif echo "$RECENT_FILES" | grep -q "\.sh$"; then
        task_desc="脚本开发任务"
    elif echo "$RECENT_FILES" | grep -q "\.claude"; then
        task_desc="Claude配置任务"
    fi
    
    echo "$task_desc"
}

# Function to show simple notification dialog
show_notification() {
    local task_name="$1"
    local timestamp=$(date '+%H:%M:%S')
    
    osascript -e "
    tell application \"Terminal\"
        activate
    end tell
    
    display dialog \"🎉 主人，您的${task_name}已经完成！\" with title \"Claude Code\" buttons {\"继续工作\", \"查看详情\"} default button \"继续工作\" with icon note giving up after 8
    
    set dialogResult to result
    if button returned of dialogResult is \"查看详情\" then
        tell application \"Terminal\"
            do script \"git log --oneline -3\"
        end tell
    end if
    "
}

# Function to send system notification
send_system_notification() {
    local task_name="$1"
    
    osascript -e "display notification \"主人，您的${task_name}已经完成！🎉\" with title \"Claude Code\" sound name \"Glass\""
}

# Function to show terminal celebration
show_terminal_celebration() {
    local task_name="$1"
    
    echo ""
    echo "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉"
    echo "🎉                                                 🎉"
    echo "🎉      恭喜主人！${task_name}已完成！       🎉"
    echo "🎉                                                 🎉"
    echo "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉"
    echo ""
    echo "✨ 完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "🤖 Claude Code智能助手"
    echo ""
}

# Main execution
main() {
    local task_name=$(get_task_description)
    
    echo "🔔 正在发送任务完成通知..."
    
    # Show terminal celebration
    show_terminal_celebration "$task_name"
    
    # Show notifications (macOS)
    if command -v osascript >/dev/null 2>&1; then
        show_notification "$task_name"
        send_system_notification "$task_name"
    else
        # Fallback for other systems
        echo "🎉 主人，您的${task_name}已经完成！"
        
        if command -v notify-send >/dev/null 2>&1; then
            notify-send "Claude Code" "主人，您的${task_name}已经完成！🎉"
        fi
    fi
    
    echo "✅ 通知发送完成"
}

main "$@"