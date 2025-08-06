#!/bin/bash

# Combined hook: commit changes and show notification
# This is the master hook that orchestrates task completion

# Colors for better terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🚀 开始执行任务完成流程...${NC}"

# Step 1: Run the commit hook
echo -e "${YELLOW}📝 步骤1: 提交代码变更${NC}"
if ./.claude/hooks/simple_commit.sh; then
    echo -e "${GREEN}✅ 代码提交成功${NC}"
    COMMIT_SUCCESS=true
else
    echo -e "${RED}❌ 代码提交失败或无变更${NC}"
    COMMIT_SUCCESS=false
fi

# Step 2: Run the notification hook
echo -e "${YELLOW}🔔 步骤2: 发送完成通知${NC}"
if ./.claude/hooks/simple_notify.sh; then
    echo -e "${GREEN}✅ 通知发送成功${NC}"
    NOTIFY_SUCCESS=true
else
    echo -e "${RED}❌ 通知发送失败${NC}"
    NOTIFY_SUCCESS=false
fi

# Summary
echo ""
echo -e "${PURPLE}📊 任务完成总结:${NC}"
if [[ "$COMMIT_SUCCESS" == true ]]; then
    echo -e "  ${GREEN}✓${NC} 代码变更已提交到版本库"
else
    echo -e "  ${YELLOW}⚠${NC} 无代码变更或提交失败"
fi

if [[ "$NOTIFY_SUCCESS" == true ]]; then
    echo -e "  ${GREEN}✓${NC} 完成通知已发送"
else
    echo -e "  ${YELLOW}⚠${NC} 通知发送失败"
fi

echo ""
echo -e "${CYAN}🎉 任务完成流程执行完毕！${NC}"

# Return success if at least one operation succeeded
if [[ "$COMMIT_SUCCESS" == true ]] || [[ "$NOTIFY_SUCCESS" == true ]]; then
    exit 0
else
    exit 1
fi