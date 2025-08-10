# 运行手册: 服务不可用故障处理

## 告警信息

**告警名称**: ServiceDown  
**严重等级**: Critical  
**响应时间**: 立即 (< 5分钟)

## 故障描述

核心服务（phone-gateway、realtime-processor、conversation-engine、profile-analytics等）出现不可用状态，health check失败。

## 影响评估

### 直接影响
- 🚨 **电话服务中断**: 无法接听新的来电
- 🚨 **AI响应失败**: 现有通话无法获得AI回复  
- 🚨 **用户体验恶化**: 客户无法正常使用服务

### 业务影响
- **收入损失**: 每分钟约￥XXX损失
- **客户满意度**: 严重下降
- **品牌声誉**: 负面影响

## 快速诊断流程

### 第一步: 确认告警真实性 (1分钟内)

```bash
# 检查服务状态
kubectl get pods -n ai-ninja | grep -E "(phone-gateway|realtime-processor|conversation-engine|profile-analytics)"

# 预期输出: 所有Pod都应该是Running状态
# 异常状态: Pending, CrashLoopBackOff, Error, ImagePullBackOff
```

### 第二步: 快速健康检查 (2分钟内)

```bash
#!/bin/bash
# 快速健康检查脚本

echo "=== 服务健康检查 ==="
services=("phone-gateway" "realtime-processor" "conversation-engine" "profile-analytics")

for service in "${services[@]}"; do
  echo "检查 $service ..."
  
  # 检查Pod状态
  kubectl get pods -n ai-ninja -l app=$service --no-headers
  
  # 检查最近的事件
  kubectl get events -n ai-ninja --field-selector involvedObject.name=$service --sort-by='.firstTimestamp' | tail -3
  
  # 尝试健康检查
  kubectl exec -n ai-ninja deployment/$service -- curl -f http://localhost:$(kubectl get service $service -n ai-ninja -o jsonpath='{.spec.ports[0].targetPort}')/health 2>/dev/null && echo "✅ $service健康" || echo "❌ $service异常"
  
  echo "---"
done
```

### 第三步: 识别故障模式 (2分钟内)

#### 模式A: 单服务故障
```bash
# 检查特定服务的详细状态
kubectl describe pod -n ai-ninja -l app=<failing-service>

# 查看最近的日志
kubectl logs -n ai-ninja deployment/<failing-service> --tail=50
```

#### 模式B: 多服务故障
```bash
# 检查集群级别问题
kubectl get nodes
kubectl top nodes
kubectl get events -n ai-ninja --sort-by='.firstTimestamp' | tail -10

# 检查基础设施
kubectl get pv,pvc -n ai-ninja
kubectl get configmap,secret -n ai-ninja
```

#### 模式C: 依赖服务故障
```bash
# 检查数据库连接
kubectl exec -n ai-ninja deployment/user-management -- pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER

# 检查Redis连接  
kubectl exec -n ai-ninja deployment/user-management -- redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# 检查外部服务
curl -I https://your-region.api.cognitive.microsoft.com/
curl -I https://your-openai.openai.azure.com/
```

## 应急修复方案

### 方案1: 服务重启 (最常用)

#### 1.1 单服务重启
```bash
# 重启特定服务
kubectl rollout restart deployment/<service-name> -n ai-ninja

# 等待并验证重启结果
kubectl rollout status deployment/<service-name> -n ai-ninja --timeout=120s

# 验证服务恢复
kubectl get pods -n ai-ninja -l app=<service-name>
```

#### 1.2 批量服务重启
```bash
#!/bin/bash
# 批量重启关键服务

services=("phone-gateway" "realtime-processor" "conversation-engine" "profile-analytics")

for service in "${services[@]}"; do
  echo "重启 $service ..."
  kubectl rollout restart deployment/$service -n ai-ninja
  
  # 等待Pod就绪
  kubectl wait --for=condition=available --timeout=120s deployment/$service -n ai-ninja
  
  if [ $? -eq 0 ]; then
    echo "✅ $service 重启成功"
  else
    echo "❌ $service 重启失败，需要人工干预"
  fi
done
```

### 方案2: 配置修复

#### 2.1 检查和修复配置
```bash
# 检查ConfigMap配置
kubectl get configmap app-config -n ai-ninja -o yaml

# 检查Secret配置
kubectl get secret app-secrets -n ai-ninja -o yaml

# 如果配置有问题，从备份恢复
kubectl apply -f k8s/configmaps/app-config.yaml
kubectl rollout restart deployment/<affected-service> -n ai-ninja
```

#### 2.2 环境变量检查
```bash
# 检查环境变量设置
kubectl exec -n ai-ninja deployment/<service-name> -- env | grep -E "(DB_|REDIS_|AZURE_)"

# 验证数据库连接字符串
kubectl exec -n ai-ninja deployment/<service-name> -- echo $DATABASE_URL
```

### 方案3: 资源扩容

#### 3.1 紧急扩容
```bash
# 检查资源使用情况
kubectl top pods -n ai-ninja

# 扩容服务实例
kubectl scale deployment <service-name> --replicas=5 -n ai-ninja

# 检查节点资源
kubectl top nodes

# 如果需要更多资源，扩容节点 (云环境)
# 这通常需要更多时间，考虑是否有其他快速方案
```

#### 3.2 资源限制调整
```bash
# 临时增加资源限制
kubectl patch deployment <service-name> -n ai-ninja -p '{"spec":{"template":{"spec":{"containers":[{"name":"<container-name>","resources":{"limits":{"memory":"2Gi","cpu":"1000m"}}}]}}}}'

# 等待Pod重建
kubectl rollout status deployment/<service-name> -n ai-ninja
```

### 方案4: 回滚版本

#### 4.1 检查部署历史
```bash
# 查看部署历史
kubectl rollout history deployment/<service-name> -n ai-ninja

# 查看特定版本详情
kubectl rollout history deployment/<service-name> --revision=<revision-number> -n ai-ninja
```

#### 4.2 执行回滚
```bash
# 回滚到上一个版本
kubectl rollout undo deployment/<service-name> -n ai-ninja

# 或回滚到特定版本
kubectl rollout undo deployment/<service-name> --to-revision=<revision-number> -n ai-ninja

# 验证回滚结果
kubectl rollout status deployment/<service-name> -n ai-ninja
```

### 方案5: 故障转移

#### 5.1 服务降级
```bash
# 启用降级模式 (如果应用支持)
kubectl patch configmap app-config -n ai-ninja --patch '{"data":{"DEGRADED_MODE":"true"}}'

# 重启相关服务使配置生效
kubectl rollout restart deployment/phone-gateway deployment/realtime-processor -n ai-ninja
```

#### 5.2 流量切换
```bash
# 将流量临时切换到备用服务
kubectl patch service phone-gateway -n ai-ninja --patch '{"spec":{"selector":{"app":"phone-gateway-backup"}}}'

# 验证流量切换
kubectl get endpoints phone-gateway -n ai-ninja
```

## 验证修复结果

### 自动化验证脚本
```bash
#!/bin/bash
# 修复后验证脚本

echo "=== 验证服务恢复 ==="

# 1. 检查Pod状态
echo "1. 检查Pod状态..."
kubectl get pods -n ai-ninja | grep -v Running | grep -v Completed && echo "❌ 存在异常Pod" || echo "✅ 所有Pod运行正常"

# 2. 健康检查
echo "2. 执行健康检查..."
services=("phone-gateway" "realtime-processor" "conversation-engine" "profile-analytics")

for service in "${services[@]}"; do
  url=$(kubectl get service $service -n ai-ninja -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
  if [ -z "$url" ]; then
    url=$(kubectl get service $service -n ai-ninja -o jsonpath='{.spec.clusterIP}')
  fi
  port=$(kubectl get service $service -n ai-ninja -o jsonpath='{.spec.ports[0].port}')
  
  curl -f http://$url:$port/health --max-time 10 >/dev/null 2>&1 && echo "✅ $service 健康检查通过" || echo "❌ $service 健康检查失败"
done

# 3. 检查关键指标
echo "3. 检查关键指标..."
curl -s 'http://prometheus:9090/api/v1/query?query=up{job=~"phone-gateway|realtime-processor|conversation-engine|profile-analytics"}' | jq -r '.data.result[] | select(.value[1] == "0") | .metric.job' | while read service; do
  echo "❌ $service 指标显示不可用"
done

# 4. 端到端测试
echo "4. 执行端到端测试..."
# 这里应该调用专门的测试脚本
# ./test-e2e.sh

echo "验证完成！"
```

### 手动验证检查清单

#### ✅ 基础验证
- [ ] 所有Pod状态为Running
- [ ] 健康检查端点响应正常
- [ ] 服务日志无ERROR级别消息
- [ ] Prometheus指标显示服务UP

#### ✅ 功能验证  
- [ ] 电话接听功能正常
- [ ] AI响应生成正常
- [ ] 数据库读写正常
- [ ] 缓存访问正常

#### ✅ 性能验证
- [ ] 响应时间在正常范围内
- [ ] CPU和内存使用正常
- [ ] 无异常的错误率升高

## 升级和通知

### 何时升级

#### 立即升级情况 (< 15分钟)
- 自动修复失败
- 影响范围扩大
- 出现数据丢失风险
- 安全相关问题

#### 升级流程
1. **通知升级**: 在Slack频道发送升级通知
2. **联系上级**: 电话联系直属经理和技术负责人
3. **更新状态**: 在事故管理系统中更新状态
4. **启动会议**: 建立紧急响应会议桥

### 通知模板

#### Slack通知模板
```
🚨 [CRITICAL] 服务不可用 - 修复进行中

服务: {{ affected_services }}
开始时间: {{ start_time }}
当前状态: {{ current_status }}
修复进度: {{ repair_progress }}

已尝试方案:
- [X] 服务重启
- [X] 配置检查  
- [ ] 版本回滚

预计恢复时间: {{ eta }}
负责工程师: @{{ engineer }}

仪表板: https://grafana.company.com/dashboard
事故追踪: https://incident.company.com/{{ incident_id }}
```

#### 客户通知模板 (如需要)
```
尊敬的客户，

我们检测到AI电话应答服务出现临时中断，我们的工程团队正在紧急处理。

影响范围: 电话接听和AI响应功能
预计恢复时间: {{ eta }}

我们深表歉意，并将在恢复后发送详细报告。

AI Answer Ninja技术团队
{{ timestamp }}
```

## 事后分析

### 根因分析模板

#### 事故时间线
```
{{ start_time }} - 首次检测到告警
{{ start_time + 2min }} - 确认服务不可用
{{ start_time + 5min }} - 开始应急修复
{{ start_time + 15min }} - 实施修复方案A
{{ start_time + 30min }} - 服务恢复正常
{{ start_time + 45min }} - 验证功能完整性
```

#### 根本原因分析 (5 Why分析法)
```
1. 为什么服务不可用？
   - 服务Pod频繁重启

2. 为什么Pod频繁重启？
   - 内存溢出导致容器被杀死

3. 为什么出现内存溢出？
   - 代码存在内存泄漏

4. 为什么存在内存泄漏？
   - 最新版本引入了bug

5. 为什么bug没有被及早发现？
   - 缺少充分的压力测试
```

### 改进措施

#### 短期改进 (1周内)
- [ ] 修复代码中的内存泄漏问题
- [ ] 增加内存使用监控告警
- [ ] 优化Pod资源配置
- [ ] 增加更详细的健康检查

#### 中期改进 (1个月内)
- [ ] 增强压力测试覆盖范围
- [ ] 实现更智能的自动恢复机制
- [ ] 优化告警响应流程
- [ ] 完善监控仪表板

#### 长期改进 (3个月内)
- [ ] 实现服务熔断和降级机制
- [ ] 建立更完善的灾备方案
- [ ] 增强可观测性能力
- [ ] 完善自动化测试体系

## 预防措施

### 日常监控
- 定期检查服务健康状态
- 监控资源使用趋势
- 关注异常日志模式
- 验证告警规则有效性

### 定期测试
- 每月进行故障演练
- 验证恢复流程有效性
- 测试告警响应时间
- 更新应急联系方式

### 持续改进
- 收集和分析故障模式
- 优化监控和告警配置
- 更新运行手册
- 培训团队成员

---

## 相关链接

- **监控仪表板**: https://grafana.company.com/d/service-overview
- **告警管理**: https://alertmanager.company.com
- **事故管理**: https://incident.company.com  
- **服务状态页**: https://status.company.com
- **技术文档**: https://docs.company.com/ai-ninja

## 联系信息

- **值班工程师**: +86-XXX-XXXX-XXXX
- **技术负责人**: tech-lead@company.com
- **紧急热线**: emergency@company.com
- **Slack频道**: #ai-ninja-incidents

---

*最后更新: 2025-08-10*  
*版本: v2.0*  
*维护者: SRE Team*