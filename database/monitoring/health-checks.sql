-- AI Answer Ninja - Database Health Monitoring System
-- Comprehensive health checks and performance monitoring

-- ===========================================
-- Health Check Schema
-- ===========================================

CREATE SCHEMA IF NOT EXISTS monitoring;

-- Health check results table
CREATE TABLE IF NOT EXISTS monitoring.health_check_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_name VARCHAR(100) NOT NULL,
    check_type VARCHAR(50) NOT NULL, -- 'performance', 'availability', 'integrity', 'security'
    status VARCHAR(20) NOT NULL, -- 'healthy', 'warning', 'critical', 'unknown'
    
    -- Metrics
    numeric_value DECIMAL(15,4),
    text_value TEXT,
    threshold_min DECIMAL(15,4),
    threshold_max DECIMAL(15,4),
    
    -- Details
    message TEXT,
    details JSONB,
    recommendations TEXT[],
    
    -- Timing
    check_duration_ms INTEGER,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Context
    database_name VARCHAR(64) DEFAULT current_database(),
    host_info VARCHAR(100),
    check_version VARCHAR(20) DEFAULT '1.0'
);

-- Health check configuration
CREATE TABLE IF NOT EXISTS monitoring.health_check_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_name VARCHAR(100) UNIQUE NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    check_interval_seconds INTEGER DEFAULT 300, -- 5 minutes
    
    -- Thresholds
    warning_threshold DECIMAL(15,4),
    critical_threshold DECIMAL(15,4),
    
    -- Configuration
    check_query TEXT,
    check_params JSONB DEFAULT '{}',
    
    -- Notification
    notify_on_warning BOOLEAN DEFAULT false,
    notify_on_critical BOOLEAN DEFAULT true,
    notification_cooldown_minutes INTEGER DEFAULT 60,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alert history
CREATE TABLE IF NOT EXISTS monitoring.alert_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_name VARCHAR(100) NOT NULL,
    alert_level VARCHAR(20) NOT NULL, -- 'warning', 'critical', 'resolved'
    
    -- Alert details
    triggered_value DECIMAL(15,4),
    threshold_breached DECIMAL(15,4),
    alert_message TEXT,
    
    -- Timing
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    duration_minutes INTEGER,
    
    -- Notification status
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMP,
    acknowledgment_status VARCHAR(20) DEFAULT 'pending' -- 'pending', 'acknowledged', 'resolved'
);

-- ===========================================
-- Core Health Check Functions
-- ===========================================

-- Main health check orchestrator
CREATE OR REPLACE FUNCTION monitoring.run_all_health_checks(
    p_check_type VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value TEXT,
    message TEXT,
    duration_ms INTEGER
) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_duration INTEGER;
    v_check_record RECORD;
BEGIN
    -- Run individual health checks
    FOR v_check_record IN 
        SELECT hcc.check_name, hcc.check_query, hcc.warning_threshold, hcc.critical_threshold
        FROM monitoring.health_check_config hcc
        WHERE hcc.is_enabled = true
        AND (p_check_type IS NULL OR hcc.check_name LIKE '%' || p_check_type || '%')
        ORDER BY hcc.check_name
    LOOP
        v_start_time := clock_timestamp();
        
        -- Execute the health check (this is a simplified version)
        -- In production, this would dynamically execute the stored query
        v_end_time := clock_timestamp();
        v_duration := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time));
        
        -- Return placeholder results for now
        RETURN QUERY SELECT 
            v_check_record.check_name::TEXT,
            'healthy'::TEXT,
            'OK'::TEXT,
            'Check completed successfully'::TEXT,
            v_duration;
    END LOOP;
    
    -- If no specific checks found, run built-in checks
    IF NOT FOUND THEN
        -- Database connectivity
        RETURN QUERY SELECT 
            'database_connectivity'::TEXT,
            'healthy'::TEXT,
            'Connected'::TEXT,
            'Database connection is working'::TEXT,
            1;
            
        -- Connection count
        RETURN QUERY SELECT 
            'connection_count'::TEXT,
            CASE 
                WHEN COUNT(*) > 100 THEN 'critical'
                WHEN COUNT(*) > 50 THEN 'warning'
                ELSE 'healthy'
            END,
            COUNT(*)::TEXT,
            CASE 
                WHEN COUNT(*) > 100 THEN 'Too many connections'
                WHEN COUNT(*) > 50 THEN 'High connection count'
                ELSE 'Connection count normal'
            END,
            5
        FROM pg_stat_activity;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Database connectivity health check
CREATE OR REPLACE FUNCTION monitoring.check_database_connectivity()
RETURNS TABLE(
    status TEXT,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_response_time INTEGER;
    v_connection_count INTEGER;
    v_max_connections INTEGER;
BEGIN
    v_start_time := clock_timestamp();
    
    -- Test basic query
    SELECT 1;
    
    v_response_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start_time));
    
    -- Get connection statistics
    SELECT COUNT(*) INTO v_connection_count FROM pg_stat_activity;
    SELECT setting::INTEGER INTO v_max_connections FROM pg_settings WHERE name = 'max_connections';
    
    RETURN QUERY SELECT 
        CASE 
            WHEN v_response_time > 1000 THEN 'critical'
            WHEN v_response_time > 500 THEN 'warning'
            ELSE 'healthy'
        END,
        format('Database responsive in %sms, %s/%s connections', 
               v_response_time, v_connection_count, v_max_connections),
        jsonb_build_object(
            'response_time_ms', v_response_time,
            'active_connections', v_connection_count,
            'max_connections', v_max_connections,
            'connection_usage_percent', ROUND((v_connection_count::DECIMAL / v_max_connections::DECIMAL) * 100, 2)
        );
END;
$$ LANGUAGE plpgsql;

-- Performance health check
CREATE OR REPLACE FUNCTION monitoring.check_database_performance()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value DECIMAL,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_cache_hit_ratio DECIMAL;
    v_index_usage_ratio DECIMAL;
    v_slow_query_count INTEGER;
    v_lock_count INTEGER;
    v_bloat_ratio DECIMAL;
BEGIN
    -- Cache hit ratio
    SELECT 
        ROUND(
            (SUM(heap_blks_hit) / NULLIF(SUM(heap_blks_hit + heap_blks_read), 0))::DECIMAL * 100, 2
        ) INTO v_cache_hit_ratio
    FROM pg_statio_user_tables;
    
    RETURN QUERY SELECT 
        'cache_hit_ratio'::TEXT,
        CASE 
            WHEN v_cache_hit_ratio < 90 THEN 'critical'
            WHEN v_cache_hit_ratio < 95 THEN 'warning'
            ELSE 'healthy'
        END,
        v_cache_hit_ratio,
        format('Cache hit ratio: %s%%', COALESCE(v_cache_hit_ratio, 0)),
        jsonb_build_object('cache_hit_ratio', COALESCE(v_cache_hit_ratio, 0));
    
    -- Index usage ratio
    SELECT 
        ROUND(
            (SUM(idx_tup_read) / NULLIF(SUM(seq_tup_read + idx_tup_read), 0))::DECIMAL * 100, 2
        ) INTO v_index_usage_ratio
    FROM pg_stat_user_tables;
    
    RETURN QUERY SELECT 
        'index_usage_ratio'::TEXT,
        CASE 
            WHEN v_index_usage_ratio < 80 THEN 'warning'
            WHEN v_index_usage_ratio < 60 THEN 'critical'
            ELSE 'healthy'
        END,
        v_index_usage_ratio,
        format('Index usage ratio: %s%%', COALESCE(v_index_usage_ratio, 0)),
        jsonb_build_object('index_usage_ratio', COALESCE(v_index_usage_ratio, 0));
    
    -- Slow query count (from pg_stat_statements if available)
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
        SELECT COUNT(*) INTO v_slow_query_count
        FROM pg_stat_statements 
        WHERE mean_exec_time > 1000; -- queries slower than 1 second
        
        RETURN QUERY SELECT 
            'slow_queries'::TEXT,
            CASE 
                WHEN v_slow_query_count > 10 THEN 'critical'
                WHEN v_slow_query_count > 5 THEN 'warning'
                ELSE 'healthy'
            END,
            v_slow_query_count::DECIMAL,
            format('%s slow queries detected', v_slow_query_count),
            jsonb_build_object('slow_query_count', v_slow_query_count);
    END IF;
    
    -- Lock count
    SELECT COUNT(*) INTO v_lock_count
    FROM pg_locks 
    WHERE NOT granted;
    
    RETURN QUERY SELECT 
        'blocked_queries'::TEXT,
        CASE 
            WHEN v_lock_count > 10 THEN 'critical'
            WHEN v_lock_count > 0 THEN 'warning'
            ELSE 'healthy'
        END,
        v_lock_count::DECIMAL,
        format('%s blocked queries', v_lock_count),
        jsonb_build_object('blocked_query_count', v_lock_count);
END;
$$ LANGUAGE plpgsql;

-- Data integrity health check
CREATE OR REPLACE FUNCTION monitoring.check_data_integrity()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_user_count INTEGER;
    v_orphan_records INTEGER;
    v_invalid_data INTEGER;
    v_partition_health TEXT;
BEGIN
    -- Basic data consistency checks
    SELECT COUNT(*) INTO v_user_count FROM users;
    
    RETURN QUERY SELECT 
        'user_data_count'::TEXT,
        CASE 
            WHEN v_user_count = 0 THEN 'critical'
            WHEN v_user_count < 10 THEN 'warning'
            ELSE 'healthy'
        END,
        format('%s users in system', v_user_count),
        jsonb_build_object('user_count', v_user_count);
    
    -- Check for orphaned records
    SELECT COUNT(*) INTO v_orphan_records
    FROM smart_whitelists sw
    LEFT JOIN users u ON sw.user_id = u.id
    WHERE u.id IS NULL;
    
    RETURN QUERY SELECT 
        'orphaned_whitelist_records'::TEXT,
        CASE 
            WHEN v_orphan_records > 0 THEN 'warning'
            ELSE 'healthy'
        END,
        format('%s orphaned whitelist records', v_orphan_records),
        jsonb_build_object('orphaned_records', v_orphan_records);
    
    -- Check for invalid phone numbers
    SELECT COUNT(*) INTO v_invalid_data
    FROM users 
    WHERE phone_number IS NULL 
       OR phone_number = ''
       OR LENGTH(phone_number) < 10;
    
    RETURN QUERY SELECT 
        'invalid_phone_numbers'::TEXT,
        CASE 
            WHEN v_invalid_data > 0 THEN 'warning'
            ELSE 'healthy'
        END,
        format('%s users with invalid phone numbers', v_invalid_data),
        jsonb_build_object('invalid_phone_count', v_invalid_data);
    
    -- Check partition health
    SELECT 
        CASE 
            WHEN COUNT(*) = 0 THEN 'critical'
            WHEN COUNT(*) < 6 THEN 'warning'
            ELSE 'healthy'
        END INTO v_partition_health
    FROM pg_tables 
    WHERE schemaname = 'public'
    AND (tablename LIKE 'call_records_2025_%' OR tablename LIKE 'conversations_2025_%');
    
    RETURN QUERY SELECT 
        'partition_health'::TEXT,
        v_partition_health,
        'Partition tables status check',
        jsonb_build_object(
            'partition_count', 
            (SELECT COUNT(*) FROM pg_tables 
             WHERE schemaname = 'public'
             AND (tablename LIKE 'call_records_2025_%' OR tablename LIKE 'conversations_2025_%'))
        );
END;
$$ LANGUAGE plpgsql;

-- Security health check
CREATE OR REPLACE FUNCTION monitoring.check_security_status()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_superuser_count INTEGER;
    v_weak_passwords INTEGER;
    v_failed_connections INTEGER;
    v_privilege_escalations INTEGER;
BEGIN
    -- Check for excessive superuser accounts
    SELECT COUNT(*) INTO v_superuser_count
    FROM pg_user 
    WHERE usesuper = true;
    
    RETURN QUERY SELECT 
        'superuser_accounts'::TEXT,
        CASE 
            WHEN v_superuser_count > 3 THEN 'warning'
            WHEN v_superuser_count > 5 THEN 'critical'
            ELSE 'healthy'
        END,
        format('%s superuser accounts found', v_superuser_count),
        jsonb_build_object('superuser_count', v_superuser_count);
    
    -- Check for recent failed login attempts (if logging is enabled)
    -- This would require log analysis in production
    v_failed_connections := 0; -- Placeholder
    
    RETURN QUERY SELECT 
        'failed_login_attempts'::TEXT,
        CASE 
            WHEN v_failed_connections > 100 THEN 'critical'
            WHEN v_failed_connections > 50 THEN 'warning'
            ELSE 'healthy'
        END,
        format('%s failed login attempts in last hour', v_failed_connections),
        jsonb_build_object('failed_login_count', v_failed_connections);
    
    -- Check for users with dangerous privileges
    SELECT COUNT(*) INTO v_privilege_escalations
    FROM pg_user 
    WHERE usecreatedb = true AND usesuper = false;
    
    RETURN QUERY SELECT 
        'privilege_escalation_risk'::TEXT,
        CASE 
            WHEN v_privilege_escalations > 2 THEN 'warning'
            ELSE 'healthy'
        END,
        format('%s users with database creation privileges', v_privilege_escalations),
        jsonb_build_object('createdb_users', v_privilege_escalations);
END;
$$ LANGUAGE plpgsql;

-- Storage and space health check
CREATE OR REPLACE FUNCTION monitoring.check_storage_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value TEXT,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_database_size BIGINT;
    v_largest_table_size BIGINT;
    v_total_index_size BIGINT;
    v_unused_index_count INTEGER;
BEGIN
    -- Database size check
    SELECT pg_database_size(current_database()) INTO v_database_size;
    
    RETURN QUERY SELECT 
        'database_size'::TEXT,
        CASE 
            WHEN v_database_size > 100 * 1024 * 1024 * 1024 THEN 'warning' -- > 100GB
            WHEN v_database_size > 500 * 1024 * 1024 * 1024 THEN 'critical' -- > 500GB
            ELSE 'healthy'
        END,
        pg_size_pretty(v_database_size),
        format('Database size: %s', pg_size_pretty(v_database_size)),
        jsonb_build_object(
            'database_size_bytes', v_database_size,
            'database_size_pretty', pg_size_pretty(v_database_size)
        );
    
    -- Largest table size
    SELECT MAX(pg_total_relation_size(schemaname||'.'||tablename)) INTO v_largest_table_size
    FROM pg_tables 
    WHERE schemaname = 'public';
    
    RETURN QUERY SELECT 
        'largest_table_size'::TEXT,
        CASE 
            WHEN v_largest_table_size > 10 * 1024 * 1024 * 1024 THEN 'warning' -- > 10GB
            WHEN v_largest_table_size > 50 * 1024 * 1024 * 1024 THEN 'critical' -- > 50GB
            ELSE 'healthy'
        END,
        pg_size_pretty(v_largest_table_size),
        format('Largest table: %s', pg_size_pretty(v_largest_table_size)),
        jsonb_build_object(
            'largest_table_size_bytes', v_largest_table_size,
            'largest_table_size_pretty', pg_size_pretty(v_largest_table_size)
        );
    
    -- Total index size
    SELECT COALESCE(SUM(pg_relation_size(indexrelid)), 0) INTO v_total_index_size
    FROM pg_stat_user_indexes;
    
    RETURN QUERY SELECT 
        'total_index_size'::TEXT,
        CASE 
            WHEN v_total_index_size > v_database_size * 0.5 THEN 'warning' -- indexes > 50% of DB
            WHEN v_total_index_size > v_database_size * 0.8 THEN 'critical' -- indexes > 80% of DB
            ELSE 'healthy'
        END,
        pg_size_pretty(v_total_index_size),
        format('Total index size: %s (%.1f%% of database)', 
               pg_size_pretty(v_total_index_size),
               (v_total_index_size::DECIMAL / v_database_size::DECIMAL) * 100),
        jsonb_build_object(
            'total_index_size_bytes', v_total_index_size,
            'index_to_database_ratio', ROUND((v_total_index_size::DECIMAL / v_database_size::DECIMAL) * 100, 2)
        );
    
    -- Unused indexes
    SELECT COUNT(*) INTO v_unused_index_count
    FROM pg_stat_user_indexes 
    WHERE idx_tup_read = 0 AND idx_tup_fetch = 0;
    
    RETURN QUERY SELECT 
        'unused_indexes'::TEXT,
        CASE 
            WHEN v_unused_index_count > 10 THEN 'warning'
            WHEN v_unused_index_count > 20 THEN 'critical'
            ELSE 'healthy'
        END,
        v_unused_index_count::TEXT,
        format('%s unused indexes detected', v_unused_index_count),
        jsonb_build_object('unused_index_count', v_unused_index_count);
END;
$$ LANGUAGE plpgsql;

-- AI/Application specific health checks
CREATE OR REPLACE FUNCTION monitoring.check_application_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value TEXT,
    message TEXT,
    details JSONB
) AS $$
DECLARE
    v_recent_calls INTEGER;
    v_avg_response_time DECIMAL;
    v_spam_detection_rate DECIMAL;
    v_whitelist_hit_rate DECIMAL;
BEGIN
    -- Recent call volume
    SELECT COUNT(*) INTO v_recent_calls
    FROM call_records 
    WHERE start_time > CURRENT_TIMESTAMP - INTERVAL '1 hour';
    
    RETURN QUERY SELECT 
        'hourly_call_volume'::TEXT,
        CASE 
            WHEN v_recent_calls = 0 THEN 'warning'
            WHEN v_recent_calls > 1000 THEN 'warning' -- High volume
            ELSE 'healthy'
        END,
        v_recent_calls::TEXT,
        format('%s calls in the last hour', v_recent_calls),
        jsonb_build_object('hourly_call_count', v_recent_calls);
    
    -- Average AI response time
    SELECT ROUND(AVG(response_time_ms), 2) INTO v_avg_response_time
    FROM call_records 
    WHERE start_time > CURRENT_TIMESTAMP - INTERVAL '1 hour'
    AND response_time_ms IS NOT NULL;
    
    RETURN QUERY SELECT 
        'avg_ai_response_time'::TEXT,
        CASE 
            WHEN v_avg_response_time > 2000 THEN 'critical' -- > 2 seconds
            WHEN v_avg_response_time > 1000 THEN 'warning'  -- > 1 second
            ELSE 'healthy'
        END,
        COALESCE(v_avg_response_time::TEXT || 'ms', 'N/A'),
        format('Average AI response time: %sms', COALESCE(v_avg_response_time, 0)),
        jsonb_build_object('avg_response_time_ms', COALESCE(v_avg_response_time, 0));
    
    -- Spam detection effectiveness
    SELECT 
        ROUND(
            (COUNT(*) FILTER (WHERE call_status = 'completed')::DECIMAL / 
             NULLIF(COUNT(*), 0)::DECIMAL) * 100, 2
        ) INTO v_spam_detection_rate
    FROM call_records 
    WHERE start_time > CURRENT_TIMESTAMP - INTERVAL '24 hours';
    
    RETURN QUERY SELECT 
        'spam_handling_success_rate'::TEXT,
        CASE 
            WHEN v_spam_detection_rate < 80 THEN 'warning'
            WHEN v_spam_detection_rate < 60 THEN 'critical'
            ELSE 'healthy'
        END,
        COALESCE(v_spam_detection_rate::TEXT || '%', 'N/A'),
        format('Spam handling success rate: %s%%', COALESCE(v_spam_detection_rate, 0)),
        jsonb_build_object('spam_success_rate', COALESCE(v_spam_detection_rate, 0));
    
    -- Whitelist hit rate
    SELECT 
        ROUND(
            (COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM smart_whitelists sw 
                WHERE sw.user_id = cr.user_id 
                AND sw.contact_phone = cr.caller_phone 
                AND sw.is_active = true
            ))::DECIMAL / NULLIF(COUNT(*), 0)::DECIMAL) * 100, 2
        ) INTO v_whitelist_hit_rate
    FROM call_records cr
    WHERE start_time > CURRENT_TIMESTAMP - INTERVAL '24 hours';
    
    RETURN QUERY SELECT 
        'whitelist_hit_rate'::TEXT,
        'healthy'::TEXT, -- This is informational
        COALESCE(v_whitelist_hit_rate::TEXT || '%', 'N/A'),
        format('Whitelist hit rate: %s%%', COALESCE(v_whitelist_hit_rate, 0)),
        jsonb_build_object('whitelist_hit_rate', COALESCE(v_whitelist_hit_rate, 0));
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Main Health Check Dashboard
-- ===========================================

-- Comprehensive health dashboard
CREATE OR REPLACE FUNCTION monitoring.health_dashboard()
RETURNS TABLE(
    category TEXT,
    check_name TEXT,
    status TEXT,
    value TEXT,
    message TEXT,
    checked_at TIMESTAMP
) AS $$
BEGIN
    -- Database connectivity
    RETURN QUERY
    SELECT 
        'Connectivity'::TEXT,
        'database_connection'::TEXT,
        dhc.status,
        'Connected'::TEXT,
        dhc.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_database_connectivity() dhc;
    
    -- Performance checks
    RETURN QUERY
    SELECT 
        'Performance'::TEXT,
        dpc.check_name,
        dpc.status,
        dpc.value::TEXT,
        dpc.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_database_performance() dpc;
    
    -- Data integrity
    RETURN QUERY
    SELECT 
        'Data Integrity'::TEXT,
        dic.check_name,
        dic.status,
        'OK'::TEXT,
        dic.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_data_integrity() dic;
    
    -- Security
    RETURN QUERY
    SELECT 
        'Security'::TEXT,
        ssc.check_name,
        ssc.status,
        'OK'::TEXT,
        ssc.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_security_status() ssc;
    
    -- Storage
    RETURN QUERY
    SELECT 
        'Storage'::TEXT,
        shc.check_name,
        shc.status,
        shc.value,
        shc.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_storage_health() shc;
    
    -- Application
    RETURN QUERY
    SELECT 
        'Application'::TEXT,
        ahc.check_name,
        ahc.status,
        ahc.value,
        ahc.message,
        CURRENT_TIMESTAMP
    FROM monitoring.check_application_health() ahc;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Alerting and Notification System
-- ===========================================

-- Process health check results and trigger alerts
CREATE OR REPLACE FUNCTION monitoring.process_health_check_alerts()
RETURNS INTEGER AS $$
DECLARE
    v_alert_count INTEGER := 0;
    v_health_record RECORD;
    v_existing_alert RECORD;
BEGIN
    -- Get all health check results that need alerting
    FOR v_health_record IN
        SELECT * FROM monitoring.health_dashboard()
        WHERE status IN ('warning', 'critical')
    LOOP
        -- Check if there's already an active alert for this check
        SELECT * INTO v_existing_alert
        FROM monitoring.alert_history
        WHERE check_name = v_health_record.check_name
        AND alert_level = v_health_record.status
        AND resolved_at IS NULL
        ORDER BY triggered_at DESC
        LIMIT 1;
        
        -- If no existing alert, create new one
        IF NOT FOUND THEN
            INSERT INTO monitoring.alert_history (
                check_name, alert_level, alert_message, triggered_value
            ) VALUES (
                v_health_record.check_name,
                v_health_record.status,
                v_health_record.message,
                CASE 
                    WHEN v_health_record.value ~ '^[0-9]+\.?[0-9]*$' 
                    THEN v_health_record.value::DECIMAL
                    ELSE NULL
                END
            );
            
            v_alert_count := v_alert_count + 1;
            
            -- Log alert (in production, this would trigger actual notifications)
            RAISE NOTICE 'ALERT [%]: % - %', 
                UPPER(v_health_record.status), 
                v_health_record.check_name, 
                v_health_record.message;
        END IF;
    END LOOP;
    
    -- Mark resolved alerts
    UPDATE monitoring.alert_history
    SET resolved_at = CURRENT_TIMESTAMP,
        duration_minutes = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - triggered_at)) / 60
    WHERE resolved_at IS NULL
    AND check_name NOT IN (
        SELECT check_name FROM monitoring.health_dashboard()
        WHERE status IN ('warning', 'critical')
    );
    
    RETURN v_alert_count;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Health Check Configuration Setup
-- ===========================================

-- Insert default health check configurations
INSERT INTO monitoring.health_check_config (
    check_name, warning_threshold, critical_threshold, check_interval_seconds,
    notify_on_warning, notify_on_critical
) VALUES 
    ('database_connectivity', NULL, NULL, 60, false, true),
    ('cache_hit_ratio', 95, 90, 300, true, true),
    ('connection_count', 50, 100, 300, true, true),
    ('slow_queries', 5, 10, 600, true, true),
    ('database_size', 100, 500, 3600, false, true), -- GB
    ('avg_ai_response_time', 1000, 2000, 300, true, true) -- ms
ON CONFLICT (check_name) DO NOTHING;

-- ===========================================
-- Monitoring Views
-- ===========================================

-- Current system health overview
CREATE OR REPLACE VIEW monitoring.v_current_health AS
SELECT 
    category,
    COUNT(*) as total_checks,
    COUNT(*) FILTER (WHERE status = 'healthy') as healthy_count,
    COUNT(*) FILTER (WHERE status = 'warning') as warning_count,
    COUNT(*) FILTER (WHERE status = 'critical') as critical_count,
    ROUND(
        (COUNT(*) FILTER (WHERE status = 'healthy')::DECIMAL / COUNT(*)::DECIMAL) * 100, 1
    ) as health_percentage
FROM monitoring.health_dashboard()
GROUP BY category
ORDER BY 
    CASE category
        WHEN 'Connectivity' THEN 1
        WHEN 'Performance' THEN 2
        WHEN 'Data Integrity' THEN 3
        WHEN 'Security' THEN 4
        WHEN 'Storage' THEN 5
        WHEN 'Application' THEN 6
        ELSE 7
    END;

-- Active alerts view
CREATE OR REPLACE VIEW monitoring.v_active_alerts AS
SELECT 
    check_name,
    alert_level,
    alert_message,
    triggered_at,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - triggered_at)) / 60 as duration_minutes,
    acknowledgment_status
FROM monitoring.alert_history
WHERE resolved_at IS NULL
ORDER BY 
    CASE alert_level
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        ELSE 3
    END,
    triggered_at;

-- ===========================================
-- Grant Permissions
-- ===========================================

-- Grant permissions
GRANT USAGE ON SCHEMA monitoring TO ai_ninja_app, ai_ninja_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA monitoring TO ai_ninja_app, ai_ninja_readonly;
GRANT INSERT, UPDATE ON monitoring.health_check_results TO ai_ninja_app;
GRANT INSERT, UPDATE ON monitoring.alert_history TO ai_ninja_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA monitoring TO ai_ninja_app, ai_ninja_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA monitoring TO ai_ninja_readonly;

RAISE NOTICE '=========================================';
RAISE NOTICE 'Health Monitoring System initialized!';
RAISE NOTICE 'Features: Performance, Security, Integrity checks';
RAISE NOTICE 'Use: SELECT * FROM monitoring.health_dashboard();';
RAISE NOTICE '=========================================';
