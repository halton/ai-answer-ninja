#!/bin/bash

# Smart task completion notification hook
# Extracts actual task description and shows personalized notification

# Function to extract task description from various sources
get_task_description() {
    local task_desc="任务"
    
    # Method 1: Check if there's a recent commit with task info
    RECENT_COMMIT=$(git log -1 --pretty=format:"%s %b" 2>/dev/null)
    
    # Method 2: Look for recently modified files to infer task type
    RECENT_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -5)
    
    # Method 3: Try to infer from file patterns
    if echo "$RECENT_FILES" | grep -q "\.md$"; then
        if echo "$RECENT_FILES" | grep -q "README\|CLAUDE\|doc"; then
            task_desc="文档更新任务"
        else
            task_desc="文档编写任务"
        fi
    elif echo "$RECENT_FILES" | grep -q "\.ts$\|\.js$"; then
        if echo "$RECENT_FILES" | grep -q "test\|spec"; then
            task_desc="测试开发任务"
        else
            task_desc="代码开发任务"
        fi
    elif echo "$RECENT_FILES" | grep -q "\.go$"; then
        task_desc="Go服务开发任务"
    elif echo "$RECENT_FILES" | grep -q "\.py$"; then
        task_desc="Python服务开发任务"
    elif echo "$RECENT_FILES" | grep -q "docker-compose\|Dockerfile"; then
        task_desc="容器配置任务"
    elif echo "$RECENT_FILES" | grep -q "\.yaml$\|\.yml$"; then
        if echo "$RECENT_FILES" | grep -q "k8s\|helm"; then
            task_desc="Kubernetes配置任务"
        else
            task_desc="配置文件更新任务"
        fi
    elif echo "$RECENT_FILES" | grep -q "\.sql$"; then
        task_desc="数据库任务"
    elif echo "$RECENT_FILES" | grep -q "\.sh$"; then
        task_desc="脚本开发任务"
    elif echo "$RECENT_FILES" | grep -q "\.claude"; then
        task_desc="Claude配置任务"
    fi
    
    # Method 4: Check for specific service directories
    if echo "$RECENT_FILES" | grep -q "user-management"; then
        task_desc="用户管理服务${task_desc}"
    elif echo "$RECENT_FILES" | grep -q "realtime-processor"; then
        task_desc="实时处理服务${task_desc}"
    elif echo "$RECENT_FILES" | grep -q "smart-whitelist"; then
        task_desc="智能白名单服务${task_desc}"
    elif echo "$RECENT_FILES" | grep -q "conversation-engine"; then
        task_desc="对话引擎服务${task_desc}"
    fi
    
    echo "$task_desc"
}

# Function to show animated notification dialog
show_animated_notification() {
    local task_name="$1"
    local timestamp=$(date '+%H:%M:%S')
    
    osascript << EOF
        -- Activate terminal first
        tell application "Terminal"
            activate
            set frontmost to true
        end tell
        
        -- Show main completion dialog with animation effect
        display dialog "🎉 主人，您的「${task_name}」已经完成！

⏰ 完成时间: ${timestamp}
🤖 由Claude Code自动完成

是否查看本次任务的详细信息？" \\
            with title "Claude Code - 任务完成通知" \\
            with icon note \\
            buttons {"继续下一个任务", "查看变更详情", "显示项目状态"} \\
            default button "继续下一个任务" \\
            giving up after 15
        
        set dialogResult to result
        set userChoice to button returned of dialogResult
        
        -- Handle user choice
        if userChoice is "查看变更详情" then
            tell application "Terminal"
                do script "echo '📋 最近的变更:' && git log --oneline -3 && echo '' && echo '📁 修改的文件:' && git diff --name-status HEAD~1 HEAD"
            end tell
        else if userChoice is "显示项目状态" then
            tell application "Terminal"
                do script "echo '📊 项目状态概览:' && git status --short && echo '' && echo '🌿 当前分支:' && git branch --show-current && echo '' && echo '📈 最近提交:' && git log --oneline -5"
            end tell
        end if
EOF
}

# Function to send system notification as backup
send_system_notification() {
    local task_name="$1"
    
    osascript << EOF
        display notification "您的「${task_name}」已经完成！🎉" \\
            with title "Claude Code 任务完成" \\
            subtitle "点击查看详情" \\
            sound name "Glass"
EOF
}

# Function to add some visual flair in terminal
show_terminal_celebration() {
    local task_name="$1"
    
    echo ""
    echo "🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊"
    echo "🎉                                                 🎉"
    echo "🎉     恭喜主人！「${task_name}」已完成！      🎉"
    echo "🎉                                                 🎉"
    echo "🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊🎊"
    echo ""
    echo "✨ 完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "🤖 由Claude Code智能助手完成"
    echo ""
}

# Main execution
main() {
    echo "🔍 正在分析任务类型..."
    
    # Get smart task description
    local task_name=$(get_task_description)
    
    echo "🎯 检测到任务类型: $task_name"
    echo "🔔 正在显示完成通知..."
    
    # Show terminal celebration first
    show_terminal_celebration "$task_name"
    
    # Show notification dialog (macOS)
    if command -v osascript >/dev/null 2>&1; then
        show_animated_notification "$task_name"
        
        # Also send system notification
        send_system_notification "$task_name"
    else
        # Fallback for other systems
        echo "🎉 主人，您的「${task_name}」已经完成！"
        
        # Try Linux notification
        if command -v notify-send >/dev/null 2>&1; then
            notify-send -t 10000 "Claude Code - 任务完成" "主人，您的「${task_name}」已经完成！🎉"
        fi
    fi
    
    echo "✅ 任务完成通知已发送"
    echo ""
}

# Execute with any passed arguments
main "$@"