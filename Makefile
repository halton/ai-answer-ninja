# AI Answer Ninja - Docker管理Makefile

# 默认环境
ENV ?= development

# Docker Compose文件配置
COMPOSE_FILE = docker-compose.yml
ifeq ($(ENV),development)
    COMPOSE_FILE += -f docker-compose.override.yml
endif
ifeq ($(ENV),production)
    COMPOSE_FILE = docker-compose.yml -f docker-compose.prod.yml
endif

# 项目名称
PROJECT_NAME = ai-ninja

# 服务列表
CORE_SERVICES = phone-gateway realtime-processor conversation-engine profile-analytics
SUPPORT_SERVICES = user-management smart-whitelist
PLATFORM_SERVICES = configuration storage monitoring
DATA_SERVICES = postgres redis
INFRA_SERVICES = nginx

ALL_SERVICES = $(CORE_SERVICES) $(SUPPORT_SERVICES) $(PLATFORM_SERVICES) $(DATA_SERVICES) $(INFRA_SERVICES)

# 颜色输出
RED = \033[0;31m
GREEN = \033[0;32m
YELLOW = \033[0;33m
BLUE = \033[0;34m
NC = \033[0m # No Color

.PHONY: help setup build up down restart logs clean status health test

# 默认目标
.DEFAULT_GOAL := help

help: ## 显示帮助信息
	@echo "$(BLUE)AI Answer Ninja - Docker 管理命令$(NC)"
	@echo ""
	@echo "$(YELLOW)可用命令:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)环境变量:$(NC)"
	@echo "  ENV=development|production  设置部署环境 (默认: development)"
	@echo ""
	@echo "$(YELLOW)示例用法:$(NC)"
	@echo "  make setup                   # 初始化开发环境"
	@echo "  make up                      # 启动所有服务"
	@echo "  make logs service=postgres   # 查看特定服务日志"
	@echo "  make ENV=production up       # 生产环境启动"

setup: ## 初始化项目环境
	@echo "$(BLUE)初始化 AI Answer Ninja 项目环境...$(NC)"
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)创建 .env 文件...$(NC)"; \
		cp .env.example .env; \
		echo "$(GREEN)✓ .env 文件已创建，请编辑配置Azure服务信息$(NC)"; \
	fi
	@echo "$(YELLOW)创建必要的目录结构...$(NC)"
	@mkdir -p logs/{phone-gateway,realtime-processor,conversation-engine,profile-analytics,user-management,smart-whitelist,configuration,storage,monitoring,nginx}
	@mkdir -p data/storage temp/audio database/{init,backups} config/{nginx/conf.d,redis,prometheus,grafana} ssl
	@echo "$(GREEN)✓ 目录结构创建完成$(NC)"
	@echo "$(YELLOW)检查 Docker 和 Docker Compose...$(NC)"
	@docker --version || (echo "$(RED)❌ Docker 未安装$(NC)" && exit 1)
	@docker-compose --version || (echo "$(RED)❌ Docker Compose 未安装$(NC)" && exit 1)
	@echo "$(GREEN)✓ 环境检查完成$(NC)"

build: ## 构建所有服务镜像
	@echo "$(BLUE)构建服务镜像 ($(ENV) 环境)...$(NC)"
	@docker-compose $(COMPOSE_FILES) build --parallel
	@echo "$(GREEN)✓ 镜像构建完成$(NC)"

build-service: ## 构建指定服务镜像 (usage: make build-service service=phone-gateway)
ifndef service
	@echo "$(RED)❌ 请指定服务名: make build-service service=<service-name>$(NC)"
	@exit 1
endif
	@echo "$(BLUE)构建 $(service) 服务镜像...$(NC)"
	@docker-compose $(COMPOSE_FILES) build $(service)
	@echo "$(GREEN)✓ $(service) 镜像构建完成$(NC)"

up: ## 启动所有服务
	@echo "$(BLUE)启动 AI Answer Ninja 服务 ($(ENV) 环境)...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d
	@echo "$(GREEN)✓ 所有服务已启动$(NC)"
	@$(MAKE) status

up-core: ## 仅启动核心服务
	@echo "$(BLUE)启动核心服务...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d $(DATA_SERVICES) $(CORE_SERVICES)
	@echo "$(GREEN)✓ 核心服务已启动$(NC)"

up-service: ## 启动指定服务 (usage: make up-service service=phone-gateway)
ifndef service
	@echo "$(RED)❌ 请指定服务名: make up-service service=<service-name>$(NC)"
	@exit 1
endif
	@echo "$(BLUE)启动 $(service) 服务...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d $(service)
	@echo "$(GREEN)✓ $(service) 服务已启动$(NC)"

down: ## 停止所有服务
	@echo "$(YELLOW)停止所有服务...$(NC)"
	@docker-compose $(COMPOSE_FILES) down
	@echo "$(GREEN)✓ 所有服务已停止$(NC)"

down-volumes: ## 停止服务并删除数据卷 (危险操作!)
	@echo "$(RED)⚠️  警告: 这将删除所有数据!$(NC)"
	@read -p "确定要继续吗? [y/N] " -n 1 -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "$(YELLOW)停止服务并删除数据卷...$(NC)"; \
		docker-compose $(COMPOSE_FILES) down -v; \
		echo "$(GREEN)✓ 服务已停止，数据卷已删除$(NC)"; \
	else \
		echo "$(BLUE)操作已取消$(NC)"; \
	fi

restart: ## 重启所有服务
	@echo "$(YELLOW)重启所有服务...$(NC)"
	@$(MAKE) down
	@$(MAKE) up

restart-service: ## 重启指定服务 (usage: make restart-service service=phone-gateway)
ifndef service
	@echo "$(RED)❌ 请指定服务名: make restart-service service=<service-name>$(NC)"
	@exit 1
endif
	@echo "$(YELLOW)重启 $(service) 服务...$(NC)"
	@docker-compose $(COMPOSE_FILES) restart $(service)
	@echo "$(GREEN)✓ $(service) 服务已重启$(NC)"

logs: ## 查看所有服务日志
	@docker-compose $(COMPOSE_FILES) logs -f

logs-service: ## 查看指定服务日志 (usage: make logs-service service=phone-gateway)
ifndef service
	@echo "$(RED)❌ 请指定服务名: make logs-service service=<service-name>$(NC)"
	@exit 1
endif
	@docker-compose $(COMPOSE_FILES) logs -f $(service)

status: ## 查看服务状态
	@echo "$(BLUE)AI Answer Ninja 服务状态:$(NC)"
	@docker-compose $(COMPOSE_FILES) ps

health: ## 检查服务健康状态
	@echo "$(BLUE)检查服务健康状态...$(NC)"
	@for service in $(ALL_SERVICES); do \
		if docker-compose $(COMPOSE_FILES) ps $$service | grep -q "Up (healthy)"; then \
			echo "$(GREEN)✓ $$service: 健康$(NC)"; \
		elif docker-compose $(COMPOSE_FILES) ps $$service | grep -q "Up"; then \
			echo "$(YELLOW)⚠ $$service: 运行中但健康检查失败$(NC)"; \
		else \
			echo "$(RED)❌ $$service: 未运行$(NC)"; \
		fi; \
	done

exec: ## 进入服务容器 (usage: make exec service=phone-gateway cmd="bash")
ifndef service
	@echo "$(RED)❌ 请指定服务名: make exec service=<service-name> cmd=<command>$(NC)"
	@exit 1
endif
	@docker-compose $(COMPOSE_FILES) exec $(service) $(if $(cmd),$(cmd),bash)

db-migrate: ## 运行数据库迁移
	@echo "$(BLUE)运行数据库迁移...$(NC)"
	@docker-compose $(COMPOSE_FILES) exec postgres psql -U postgres -d ai_ninja -f /docker-entrypoint-initdb.d/schema.sql
	@echo "$(GREEN)✓ 数据库迁移完成$(NC)"

db-backup: ## 备份数据库
	@echo "$(BLUE)备份数据库...$(NC)"
	@mkdir -p database/backups
	@docker-compose $(COMPOSE_FILES) exec postgres pg_dump -U postgres ai_ninja > database/backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "$(GREEN)✓ 数据库备份完成$(NC)"

db-restore: ## 恢复数据库 (usage: make db-restore file=backup_20231201_120000.sql)
ifndef file
	@echo "$(RED)❌ 请指定备份文件: make db-restore file=<backup-file>$(NC)"
	@exit 1
endif
	@echo "$(YELLOW)恢复数据库从 $(file)...$(NC)"
	@docker-compose $(COMPOSE_FILES) exec -T postgres psql -U postgres ai_ninja < database/backups/$(file)
	@echo "$(GREEN)✓ 数据库恢复完成$(NC)"

clean: ## 清理未使用的Docker资源
	@echo "$(YELLOW)清理未使用的Docker资源...$(NC)"
	@docker system prune -f
	@docker volume prune -f
	@echo "$(GREEN)✓ 清理完成$(NC)"

clean-all: ## 清理所有项目相关资源 (危险操作!)
	@echo "$(RED)⚠️  警告: 这将删除所有项目容器、镜像和数据!$(NC)"
	@read -p "确定要继续吗? [y/N] " -n 1 -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "$(YELLOW)清理所有项目资源...$(NC)"; \
		docker-compose $(COMPOSE_FILES) down -v --rmi all; \
		docker system prune -a -f; \
		echo "$(GREEN)✓ 所有资源已清理$(NC)"; \
	else \
		echo "$(BLUE)操作已取消$(NC)"; \
	fi

test: ## 运行测试套件
	@echo "$(BLUE)运行测试套件...$(NC)"
	@for service in $(CORE_SERVICES) $(SUPPORT_SERVICES); do \
		echo "$(YELLOW)测试 $$service...$(NC)"; \
		docker-compose $(COMPOSE_FILES) exec $$service npm test || true; \
	done
	@echo "$(GREEN)✓ 测试完成$(NC)"

dev-tools: ## 启动开发工具 (pgAdmin, Redis Commander, Kibana)
ifeq ($(ENV),development)
	@echo "$(BLUE)启动开发工具...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d pgadmin redis-commander elasticsearch kibana swagger-ui
	@echo "$(GREEN)✓ 开发工具已启动$(NC)"
	@echo "$(YELLOW)访问地址:$(NC)"
	@echo "  pgAdmin:         http://localhost:8080"
	@echo "  Redis Commander: http://localhost:8081" 
	@echo "  Swagger UI:      http://localhost:8082"
	@echo "  Kibana:          http://localhost:5601"
else
	@echo "$(RED)❌ 开发工具仅在development环境可用$(NC)"
endif

prod-deploy: ## 生产环境部署
	@echo "$(BLUE)生产环境部署...$(NC)"
	@$(MAKE) ENV=production build
	@$(MAKE) ENV=production up
	@$(MAKE) ENV=production health
	@echo "$(GREEN)✓ 生产环境部署完成$(NC)"

scale: ## 扩缩容服务 (usage: make scale service=realtime-processor replicas=3)
ifndef service
	@echo "$(RED)❌ 请指定服务名和副本数: make scale service=<service-name> replicas=<number>$(NC)"
	@exit 1
endif
ifndef replicas
	@echo "$(RED)❌ 请指定副本数: make scale service=<service-name> replicas=<number>$(NC)"
	@exit 1
endif
	@echo "$(BLUE)扩缩容 $(service) 到 $(replicas) 个副本...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d --scale $(service)=$(replicas)
	@echo "$(GREEN)✓ $(service) 已扩缩容到 $(replicas) 个副本$(NC)"

# 内部变量设置
COMPOSE_FILES = $(addprefix -f , $(COMPOSE_FILE))