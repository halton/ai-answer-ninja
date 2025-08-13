{{/*
Expand the name of the chart.
*/}}
{{- define "ai-ninja.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "ai-ninja.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ai-ninja.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ai-ninja.labels" -}}
helm.sh/chart: {{ include "ai-ninja.chart" . }}
{{ include "ai-ninja.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
environment: {{ .Values.global.environment | default "production" }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ai-ninja.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-ninja.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service labels for specific components
*/}}
{{- define "ai-ninja.serviceLabels" -}}
{{ include "ai-ninja.labels" . }}
{{- if .component }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- if .tier }}
tier: {{ .tier }}
{{- end }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "ai-ninja.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ai-ninja.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the service account for a specific service
*/}}
{{- define "ai-ninja.serviceAccountNameForService" -}}
{{- $serviceName := .serviceName -}}
{{- if .Values.serviceAccount.create }}
{{- printf "%s-sa" $serviceName }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Generate image reference
*/}}
{{- define "ai-ninja.image" -}}
{{- $registry := .Values.global.imageRegistry | default .Values.image.registry -}}
{{- $repository := .repository -}}
{{- $tag := .tag | default .Values.image.tag | default .Chart.AppVersion -}}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repository $tag }}
{{- else }}
{{- printf "%s:%s" $repository $tag }}
{{- end }}
{{- end }}

{{/*
Generate full image reference with pullPolicy
*/}}
{{- define "ai-ninja.imageWithPolicy" -}}
image: {{ include "ai-ninja.image" . }}
imagePullPolicy: {{ .Values.image.pullPolicy }}
{{- end }}

{{/*
Generate environment variables for a service
*/}}
{{- define "ai-ninja.envVars" -}}
{{- range $key, $value := .env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}

{{/*
Generate environment variables from ConfigMap
*/}}
{{- define "ai-ninja.envFromConfigMap" -}}
envFrom:
- configMapRef:
    name: {{ include "ai-ninja.fullname" . }}-config
{{- if .additionalConfigMaps }}
{{- range .additionalConfigMaps }}
- configMapRef:
    name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate environment variables from Secrets
*/}}
{{- define "ai-ninja.envFromSecrets" -}}
{{- range .secrets }}
- secretRef:
    name: {{ . }}
{{- end }}
{{- end }}

{{/*
Generate resource requirements
*/}}
{{- define "ai-ninja.resources" -}}
{{- if .resources }}
resources:
{{- if .resources.requests }}
  requests:
{{- range $key, $value := .resources.requests }}
    {{ $key }}: {{ $value }}
{{- end }}
{{- end }}
{{- if .resources.limits }}
  limits:
{{- range $key, $value := .resources.limits }}
    {{ $key }}: {{ $value }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate health check probes
*/}}
{{- define "ai-ninja.healthChecks" -}}
{{- if .healthCheck.enabled }}
livenessProbe:
  httpGet:
    path: {{ .healthCheck.path | default "/health" }}
    port: http
    scheme: HTTP
  initialDelaySeconds: {{ .healthCheck.initialDelaySeconds | default 30 }}
  periodSeconds: {{ .healthCheck.periodSeconds | default 10 }}
  timeoutSeconds: {{ .healthCheck.timeoutSeconds | default 5 }}
  failureThreshold: {{ .healthCheck.failureThreshold | default 3 }}
  successThreshold: {{ .healthCheck.successThreshold | default 1 }}
readinessProbe:
  httpGet:
    path: {{ .healthCheck.readinessPath | default .healthCheck.path | default "/ready" }}
    port: http
    scheme: HTTP
  initialDelaySeconds: {{ .healthCheck.readinessInitialDelaySeconds | default 10 }}
  periodSeconds: {{ .healthCheck.readinessPeriodSeconds | default 5 }}
  timeoutSeconds: {{ .healthCheck.readinessTimeoutSeconds | default 3 }}
  failureThreshold: {{ .healthCheck.readinessFailureThreshold | default 3 }}
  successThreshold: {{ .healthCheck.readinessSuccessThreshold | default 1 }}
startupProbe:
  httpGet:
    path: {{ .healthCheck.path | default "/health" }}
    port: http
    scheme: HTTP
  initialDelaySeconds: {{ .healthCheck.startupInitialDelaySeconds | default 10 }}
  periodSeconds: {{ .healthCheck.startupPeriodSeconds | default 5 }}
  timeoutSeconds: {{ .healthCheck.startupTimeoutSeconds | default 3 }}
  failureThreshold: {{ .healthCheck.startupFailureThreshold | default 6 }}
  successThreshold: {{ .healthCheck.startupSuccessThreshold | default 1 }}
{{- end }}
{{- end }}

{{/*
Generate node selector
*/}}
{{- define "ai-ninja.nodeSelector" -}}
{{- if .nodeSelector }}
nodeSelector:
{{- range $key, $value := .nodeSelector }}
  {{ $key }}: {{ $value }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate tolerations
*/}}
{{- define "ai-ninja.tolerations" -}}
{{- if .tolerations }}
tolerations:
{{- range .tolerations }}
- key: {{ .key | quote }}
  operator: {{ .operator | quote }}
  value: {{ .value | quote }}
  effect: {{ .effect | quote }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate affinity rules
*/}}
{{- define "ai-ninja.affinity" -}}
{{- if .affinity }}
affinity:
{{ toYaml .affinity | indent 2 }}
{{- else }}
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app.kubernetes.io/name
            operator: In
            values:
            - {{ .serviceName }}
        topologyKey: kubernetes.io/hostname
{{- end }}
{{- end }}

{{/*
Generate security context
*/}}
{{- define "ai-ninja.securityContext" -}}
{{- if .Values.security.securityContext }}
securityContext:
{{ toYaml .Values.security.securityContext | indent 2 }}
{{- end }}
{{- end }}

{{/*
Generate pod security context
*/}}
{{- define "ai-ninja.podSecurityContext" -}}
{{- if .Values.security.securityContext }}
securityContext:
  runAsNonRoot: {{ .Values.security.securityContext.runAsNonRoot | default true }}
  runAsUser: {{ .Values.security.securityContext.runAsUser | default 1001 }}
  runAsGroup: {{ .Values.security.securityContext.runAsGroup | default 1001 }}
  fsGroup: {{ .Values.security.securityContext.fsGroup | default 1001 }}
{{- end }}
{{- end }}

{{/*
Generate volume mounts for a service
*/}}
{{- define "ai-ninja.volumeMounts" -}}
{{- if .volumes }}
volumeMounts:
{{- range $name, $config := .volumes }}
{{- if $config.enabled }}
- name: {{ $name }}
  mountPath: {{ $config.mountPath }}
  {{- if $config.subPath }}
  subPath: {{ $config.subPath }}
  {{- end }}
  {{- if $config.readOnly }}
  readOnly: {{ $config.readOnly }}
  {{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate volumes for a service
*/}}
{{- define "ai-ninja.volumes" -}}
{{- if .volumes }}
volumes:
{{- range $name, $config := .volumes }}
{{- if $config.enabled }}
- name: {{ $name }}
  {{- if eq $config.type "emptyDir" }}
  emptyDir:
    {{- if $config.medium }}
    medium: {{ $config.medium }}
    {{- end }}
    {{- if $config.sizeLimit }}
    sizeLimit: {{ $config.sizeLimit }}
    {{- end }}
  {{- else if eq $config.type "persistentVolumeClaim" }}
  persistentVolumeClaim:
    claimName: {{ $config.claimName }}
  {{- else if eq $config.type "configMap" }}
  configMap:
    name: {{ $config.configMapName }}
    {{- if $config.defaultMode }}
    defaultMode: {{ $config.defaultMode }}
    {{- end }}
  {{- else if eq $config.type "secret" }}
  secret:
    secretName: {{ $config.secretName }}
    {{- if $config.defaultMode }}
    defaultMode: {{ $config.defaultMode }}
    {{- end }}
  {{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate HPA configuration
*/}}
{{- define "ai-ninja.hpa" -}}
{{- if .autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ .serviceName }}-hpa
  namespace: {{ .Values.namespace.name }}
  labels:
    {{- include "ai-ninja.serviceLabels" (dict "Values" .Values "serviceName" .serviceName "component" .component "tier" .tier) | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ .serviceName }}
  minReplicas: {{ .autoscaling.minReplicas }}
  maxReplicas: {{ .autoscaling.maxReplicas }}
  metrics:
  {{- if .autoscaling.targetCPUUtilizationPercentage }}
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: {{ .autoscaling.targetCPUUtilizationPercentage }}
  {{- end }}
  {{- if .autoscaling.targetMemoryUtilizationPercentage }}
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: {{ .autoscaling.targetMemoryUtilizationPercentage }}
  {{- end }}
  {{- if .autoscaling.customMetrics }}
  {{- range .autoscaling.customMetrics }}
  - type: Pods
    pods:
      metric:
        name: {{ .name }}
      target:
        type: AverageValue
        averageValue: {{ .target }}
  {{- end }}
  {{- end }}
  {{- if .autoscaling.behavior }}
  behavior:
{{ toYaml .autoscaling.behavior | indent 4 }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Generate service monitor for Prometheus
*/}}
{{- define "ai-ninja.serviceMonitor" -}}
{{- if .Values.monitoring.serviceMonitor.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ .serviceName }}-monitor
  namespace: {{ .Values.namespace.name }}
  labels:
    {{- include "ai-ninja.serviceLabels" (dict "Values" .Values "serviceName" .serviceName "component" .component "tier" .tier) | nindent 4 }}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .serviceName }}
  endpoints:
  - port: http
    path: /metrics
    interval: {{ .Values.monitoring.serviceMonitor.interval }}
    scrapeTimeout: {{ .Values.monitoring.serviceMonitor.scrapeTimeout }}
{{- end }}
{{- end }}