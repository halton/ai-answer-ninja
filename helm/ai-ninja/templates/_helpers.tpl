{{/*
AI Answer Ninja - Helm Template Helpers
Common template functions and labels
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "ai-ninja.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
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
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ai-ninja.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-ninja.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service labels for specific component
*/}}
{{- define "ai-ninja.serviceLabels" -}}
{{ include "ai-ninja.labels" . }}
{{- if .component }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- if .tier }}
app.kubernetes.io/part-of: {{ .tier }}
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
Image repository with registry
*/}}
{{- define "ai-ninja.imageRepository" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s" .Values.global.imageRegistry .repository }}
{{- else }}
{{- .repository }}
{{- end }}
{{- end }}

{{/*
Common environment variables
*/}}
{{- define "ai-ninja.commonEnvVars" -}}
- name: NODE_ENV
  value: {{ .Values.global.environment | quote }}
- name: LOG_LEVEL
  value: {{ .Values.config.configMaps.app.logLevel | quote }}
- name: LOG_FORMAT
  value: {{ .Values.config.configMaps.app.logFormat | quote }}
- name: POSTGRES_URL
  value: "postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@{{ .Release.Name }}-postgresql:5432/$(POSTGRES_DB)"
- name: POSTGRES_USER
  value: "postgres"
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Release.Name }}-postgresql
      key: postgres-password
- name: POSTGRES_DB
  value: {{ .Values.postgresql.auth.database | quote }}
- name: REDIS_URL
  value: "redis://:$(REDIS_PASSWORD)@{{ .Release.Name }}-redis-master:6379"
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Release.Name }}-redis
      key: redis-password
{{- end }}

{{/*
Azure service environment variables
*/}}
{{- define "ai-ninja.azureEnvVars" -}}
- name: AZURE_COMMUNICATION_CONNECTION_STRING
  valueFrom:
    secretKeyRef:
      name: {{ include "ai-ninja.fullname" . }}-secrets
      key: AZURE_COMMUNICATION_CONNECTION_STRING
- name: AZURE_SPEECH_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "ai-ninja.fullname" . }}-secrets
      key: AZURE_SPEECH_KEY
- name: AZURE_SPEECH_REGION
  valueFrom:
    secretKeyRef:
      name: {{ include "ai-ninja.fullname" . }}-secrets
      key: AZURE_SPEECH_REGION
- name: AZURE_OPENAI_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "ai-ninja.fullname" . }}-secrets
      key: AZURE_OPENAI_KEY
- name: AZURE_OPENAI_ENDPOINT
  valueFrom:
    secretKeyRef:
      name: {{ include "ai-ninja.fullname" . }}-secrets
      key: AZURE_OPENAI_ENDPOINT
{{- end }}

{{/*
Common resource specifications
*/}}
{{- define "ai-ninja.resources" -}}
{{- if .resources }}
resources:
  {{- if .resources.requests }}
  requests:
    {{- if .resources.requests.memory }}
    memory: {{ .resources.requests.memory | quote }}
    {{- end }}
    {{- if .resources.requests.cpu }}
    cpu: {{ .resources.requests.cpu | quote }}
    {{- end }}
  {{- end }}
  {{- if .resources.limits }}
  limits:
    {{- if .resources.limits.memory }}
    memory: {{ .resources.limits.memory | quote }}
    {{- end }}
    {{- if .resources.limits.cpu }}
    cpu: {{ .resources.limits.cpu | quote }}
    {{- end }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Common liveness probe
*/}}
{{- define "ai-ninja.livenessProbe" -}}
livenessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  initialDelaySeconds: 30
  periodSeconds: 30
  timeoutSeconds: 5
  successThreshold: 1
  failureThreshold: 3
{{- end }}

{{/*
Common readiness probe
*/}}
{{- define "ai-ninja.readinessProbe" -}}
readinessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 3
  successThreshold: 1
  failureThreshold: 3
{{- end }}

{{/*
HPA template
*/}}
{{- define "ai-ninja.hpa" -}}
{{- if .autoscaling.enabled }}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ .name }}-hpa
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "ai-ninja.serviceLabels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ .name }}
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
  {{- if .autoscaling.scaleUpBehavior }}
  behavior:
    scaleUp:
      {{- toYaml .autoscaling.scaleUpBehavior | nindent 6 }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Service template
*/}}
{{- define "ai-ninja.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}-service
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "ai-ninja.serviceLabels" . | nindent 4 }}
spec:
  selector:
    app: {{ .name }}
  ports:
  {{- if .service.ports }}
  {{- range $name, $port := .service.ports }}
  - port: {{ $port }}
    targetPort: {{ $port }}
    name: {{ $name }}
    protocol: TCP
  {{- end }}
  {{- else }}
  - port: {{ .service.port }}
    targetPort: {{ .service.port }}
    name: http
    protocol: TCP
  {{- end }}
  type: {{ .service.type | default "ClusterIP" }}
  {{- if .service.sessionAffinity }}
  sessionAffinity: {{ .service.sessionAffinity }}
  {{- if .service.sessionAffinityConfig }}
  sessionAffinityConfig:
    {{- toYaml .service.sessionAffinityConfig | nindent 4 }}
  {{- end }}
  {{- end }}
{{- end }}