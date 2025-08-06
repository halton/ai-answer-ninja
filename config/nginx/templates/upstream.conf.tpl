# Dynamic upstream configuration using Consul service discovery

# Phone Gateway Upstream - Auto Discovery
upstream phone_gateway_upstream {
    least_conn;
    {{- range service "phone-gateway" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 32;
}

# Real-time Processor Upstream - Auto Discovery (Critical Service)
upstream realtime_processor_upstream {
    least_conn;
    {{- range service "realtime-processor" }}
    server {{ .Address }}:{{ .Port }} max_fails=2 fail_timeout=10s;
    {{- end }}
    keepalive 64;
}

# Conversation Engine Upstream - Auto Discovery
upstream conversation_engine_upstream {
    round_robin;
    {{- range service "conversation-engine" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 32;
}

# Profile Analytics Upstream - Auto Discovery
upstream profile_analytics_upstream {
    round_robin;
    {{- range service "profile-analytics" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 16;
}

# User Management Upstream - Auto Discovery (Session Affinity)
upstream user_management_upstream {
    ip_hash;
    {{- range service "user-management" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 16;
}

# Smart Whitelist Upstream - Auto Discovery
upstream smart_whitelist_upstream {
    least_conn;
    {{- range service "smart-whitelist" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 16;
}

# Configuration Service Upstream - Auto Discovery
upstream configuration_upstream {
    round_robin;
    {{- range service "configuration" }}
    server {{ .Address }}:{{ .Port }} max_fails=2 fail_timeout=60s;
    {{- end }}
    keepalive 8;
}

# Storage Service Upstream - Auto Discovery
upstream storage_upstream {
    least_conn;
    {{- range service "storage" }}
    server {{ .Address }}:{{ .Port }} max_fails=3 fail_timeout=30s;
    {{- end }}
    keepalive 16;
}

# Monitoring Service Upstream - Auto Discovery
upstream monitoring_upstream {
    round_robin;
    {{- range service "monitoring" }}
    server {{ .Address }}:{{ .Port }} max_fails=2 fail_timeout=60s;
    {{- end }}
    keepalive 8;
}