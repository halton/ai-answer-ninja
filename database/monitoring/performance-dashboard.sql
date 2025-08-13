-- AI Answer Ninja - Performance Monitoring Dashboard
-- Real-time performance metrics and optimization insights

-- ===========================================
-- Performance Monitoring Views
-- ===========================================

-- Real-time call processing performance
CREATE OR REPLACE VIEW monitoring.v_realtime_call_performance AS
SELECT 
    DATE_TRUNC('minute', start_time) as time_bucket,
    COUNT(*) as call_count,
    ROUND(AVG(response_time_ms), 2) as avg_response_time_ms,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms), 2) as p50_response_time_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 2) as p95_response_time_ms,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms), 2) as p99_response_time_ms,
    ROUND(AVG(cache_hit_ratio) * 100, 2) as avg_cache_hit_ratio,
    COUNT(*) FILTER (WHERE response_time_ms > 1000) as slow_calls,
    COUNT(*) FILTER (WHERE call_status = 'failed') as failed_calls,
    ROUND((COUNT(*) FILTER (WHERE call_status = 'failed')::DECIMAL / COUNT(*)::DECIMAL) * 100, 2) as failure_rate
FROM call_records 
WHERE start_time >= CURRENT_TIMESTAMP - INTERVAL '2 hours'
AND response_time_ms IS NOT NULL
GROUP BY DATE_TRUNC('minute', start_time)
ORDER BY time_bucket DESC
LIMIT 120; -- Last 2 hours

-- AI model performance comparison
CREATE OR REPLACE VIEW monitoring.v_ai_model_performance AS
SELECT 
    ai_model_version,
    DATE_TRUNC('hour', start_time) as hour_bucket,
    COUNT(*) as request_count,
    ROUND(AVG(response_time_ms), 2) as avg_response_time_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 2) as p95_response_time_ms,
    ROUND(AVG(cache_hit_ratio) * 100, 2) as cache_hit_percentage,
    COUNT(*) FILTER (WHERE response_time_ms > 1500) as timeout_prone_requests,
    ROUND(
        (COUNT(*) FILTER (WHERE call_status = 'completed')::DECIMAL / COUNT(*)::DECIMAL) * 100, 2
    ) as success_rate
FROM call_records 
WHERE start_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
AND ai_model_version IS NOT NULL
AND response_time_ms IS NOT NULL
GROUP BY ai_model_version, DATE_TRUNC('hour', start_time)
ORDER BY hour_bucket DESC, ai_model_version;

-- Database query performance insights
CREATE OR REPLACE VIEW monitoring.v_query_performance AS
WITH query_stats AS (
    SELECT 
        query,
        calls,
        total_exec_time,
        mean_exec_time,
        min_exec_time,
        max_exec_time,
        stddev_exec_time,
        rows,
        100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0) AS hit_percent
    FROM pg_stat_statements 
    WHERE calls > 10 -- Only queries called more than 10 times
)
SELECT 
    LEFT(query, 100) || CASE WHEN LENGTH(query) > 100 THEN '...' ELSE '' END as query_preview,
    calls,
    ROUND(total_exec_time::NUMERIC, 2) as total_time_ms,
    ROUND(mean_exec_time::NUMERIC, 2) as avg_time_ms,
    ROUND(max_exec_time::NUMERIC, 2) as max_time_ms,
    ROUND(stddev_exec_time::NUMERIC, 2) as stddev_time_ms,
    rows,
    ROUND(hit_percent::NUMERIC, 2) as cache_hit_percent,
    CASE 
        WHEN mean_exec_time > 1000 THEN 'SLOW'
        WHEN mean_exec_time > 500 THEN 'MODERATE'
        ELSE 'FAST'
    END as performance_category
FROM query_stats
ORDER BY total_exec_time DESC
LIMIT 50;

-- Index usage and efficiency
CREATE OR REPLACE VIEW monitoring.v_index_efficiency AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    CASE 
        WHEN idx_tup_read = 0 THEN 'UNUSED'
        WHEN idx_tup_read < 100 THEN 'LOW_USAGE'
        WHEN idx_tup_read < 1000 THEN 'MODERATE_USAGE'
        ELSE 'HIGH_USAGE'
    END as usage_category,
    ROUND(
        CASE 
            WHEN idx_tup_read > 0 
            THEN (idx_tup_fetch::DECIMAL / idx_tup_read::DECIMAL) * 100
            ELSE 0
        END, 2
    ) as efficiency_percent,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY idx_tup_read DESC;

-- Table statistics and bloat analysis
CREATE OR REPLACE VIEW monitoring.v_table_health AS
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_tuples,
    n_dead_tup as dead_tuples,
    CASE 
        WHEN n_live_tup > 0 
        THEN ROUND((n_dead_tup::DECIMAL / n_live_tup::DECIMAL) * 100, 2)
        ELSE 0
    END as dead_tuple_percent,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    CASE 
        WHEN n_dead_tup::DECIMAL / NULLIF(n_live_tup, 0)::DECIMAL > 0.2 THEN 'NEEDS_VACUUM'
        WHEN last_autovacuum < CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 'VACUUM_OVERDUE'
        WHEN last_autoanalyze < CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 'ANALYZE_OVERDUE'
        ELSE 'HEALTHY'
    END as maintenance_status
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Connection and session analysis
CREATE OR REPLACE VIEW monitoring.v_connection_analysis AS
SELECT 
    state,
    COUNT(*) as connection_count,
    ROUND(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - backend_start)))) as avg_session_duration_seconds,
    ROUND(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - state_change)))) as avg_state_duration_seconds,
    COUNT(*) FILTER (WHERE state = 'active') as active_connections,
    COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
    COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
    COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL) as waiting_connections
FROM pg_stat_activity 
WHERE pid != pg_backend_pid()
GROUP BY state
ORDER BY connection_count DESC;

-- ===========================================
-- Performance Analysis Functions
-- ===========================================

-- Analyze slow queries and recommendations
CREATE OR REPLACE FUNCTION monitoring.analyze_slow_queries(
    p_time_threshold_ms INTEGER DEFAULT 1000,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
    query_hash TEXT,
    query_preview TEXT,
    avg_execution_time_ms NUMERIC,
    total_calls BIGINT,
    total_time_ms NUMERIC,
    recommendation TEXT,
    priority TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        md5(pss.query) as query_hash,
        LEFT(pss.query, 100) || CASE WHEN LENGTH(pss.query) > 100 THEN '...' ELSE '' END,
        ROUND(pss.mean_exec_time::NUMERIC, 2),
        pss.calls,
        ROUND(pss.total_exec_time::NUMERIC, 2),
        CASE 
            WHEN pss.mean_exec_time > 5000 THEN 'Critical: Review query logic and add indexes'
            WHEN pss.mean_exec_time > 2000 THEN 'High: Consider query optimization'
            WHEN pss.calls > 1000 AND pss.mean_exec_time > 500 THEN 'Medium: Frequent slow query, optimize'
            ELSE 'Low: Monitor performance'
        END,
        CASE 
            WHEN pss.mean_exec_time > 5000 THEN 'CRITICAL'
            WHEN pss.mean_exec_time > 2000 THEN 'HIGH'
            WHEN pss.calls > 1000 AND pss.mean_exec_time > 500 THEN 'MEDIUM'
            ELSE 'LOW'
        END
    FROM pg_stat_statements pss
    WHERE pss.mean_exec_time > p_time_threshold_ms
    AND pss.calls > 5
    ORDER BY pss.total_exec_time DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Identify missing indexes
CREATE OR REPLACE FUNCTION monitoring.suggest_missing_indexes()
RETURNS TABLE(
    table_name TEXT,
    seq_scan_count BIGINT,
    seq_tup_read BIGINT,
    avg_tuples_per_scan NUMERIC,
    recommendation TEXT,
    priority TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sut.relname::TEXT,
        sut.seq_scan,
        sut.seq_tup_read,
        CASE 
            WHEN sut.seq_scan > 0 
            THEN ROUND(sut.seq_tup_read::NUMERIC / sut.seq_scan::NUMERIC, 2)
            ELSE 0
        END,
        CASE 
            WHEN sut.seq_scan > 1000 AND sut.seq_tup_read > 100000 
            THEN 'High sequential scan activity - consider adding indexes'
            WHEN sut.seq_scan > 500 AND sut.seq_tup_read > 50000 
            THEN 'Moderate sequential scan activity - review query patterns'
            ELSE 'Monitor sequential scan patterns'
        END,
        CASE 
            WHEN sut.seq_scan > 1000 AND sut.seq_tup_read > 100000 THEN 'HIGH'
            WHEN sut.seq_scan > 500 AND sut.seq_tup_read > 50000 THEN 'MEDIUM'
            ELSE 'LOW'
        END
    FROM pg_stat_user_tables sut
    WHERE sut.seq_scan > 100  -- Tables with significant sequential scans
    ORDER BY (sut.seq_scan * sut.seq_tup_read) DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- Analyze cache performance
CREATE OR REPLACE FUNCTION monitoring.analyze_cache_performance()
RETURNS TABLE(
    metric_name TEXT,
    current_value NUMERIC,
    target_value NUMERIC,
    status TEXT,
    recommendation TEXT
) AS $$
DECLARE
    v_buffer_cache_hit_ratio NUMERIC;
    v_index_cache_hit_ratio NUMERIC;
    v_shared_buffers_mb NUMERIC;
    v_effective_cache_size_mb NUMERIC;
BEGIN
    -- Calculate buffer cache hit ratio
    SELECT 
        ROUND(
            (SUM(heap_blks_hit) / NULLIF(SUM(heap_blks_hit + heap_blks_read), 0))::NUMERIC * 100, 2
        ) INTO v_buffer_cache_hit_ratio
    FROM pg_statio_user_tables;
    
    -- Calculate index cache hit ratio
    SELECT 
        ROUND(
            (SUM(idx_blks_hit) / NULLIF(SUM(idx_blks_hit + idx_blks_read), 0))::NUMERIC * 100, 2
        ) INTO v_index_cache_hit_ratio
    FROM pg_statio_user_indexes;
    
    -- Get current cache settings
    SELECT (setting::INTEGER * 8) / 1024 INTO v_shared_buffers_mb 
    FROM pg_settings WHERE name = 'shared_buffers';
    
    SELECT (setting::INTEGER * 8) / 1024 INTO v_effective_cache_size_mb 
    FROM pg_settings WHERE name = 'effective_cache_size';
    
    -- Return analysis results
    RETURN QUERY VALUES 
        ('Buffer Cache Hit Ratio', v_buffer_cache_hit_ratio, 95.0::NUMERIC,
         CASE WHEN v_buffer_cache_hit_ratio >= 95 THEN 'GOOD' 
              WHEN v_buffer_cache_hit_ratio >= 90 THEN 'OK' 
              ELSE 'POOR' END,
         CASE WHEN v_buffer_cache_hit_ratio < 95 
              THEN 'Consider increasing shared_buffers or optimizing queries'
              ELSE 'Buffer cache performance is good' END),
              
        ('Index Cache Hit Ratio', v_index_cache_hit_ratio, 95.0::NUMERIC,
         CASE WHEN v_index_cache_hit_ratio >= 95 THEN 'GOOD' 
              WHEN v_index_cache_hit_ratio >= 90 THEN 'OK' 
              ELSE 'POOR' END,
         CASE WHEN v_index_cache_hit_ratio < 95 
              THEN 'Index cache performance could be improved'
              ELSE 'Index cache performance is good' END),
              
        ('Shared Buffers (MB)', v_shared_buffers_mb, 512.0::NUMERIC,
         CASE WHEN v_shared_buffers_mb >= 512 THEN 'GOOD' 
              WHEN v_shared_buffers_mb >= 256 THEN 'OK' 
              ELSE 'LOW' END,
         CASE WHEN v_shared_buffers_mb < 256 
              THEN 'Consider increasing shared_buffers for better performance'
              ELSE 'Shared buffers setting is adequate' END),
              
        ('Effective Cache Size (MB)', v_effective_cache_size_mb, 2048.0::NUMERIC,
         CASE WHEN v_effective_cache_size_mb >= 2048 THEN 'GOOD' 
              WHEN v_effective_cache_size_mb >= 1024 THEN 'OK' 
              ELSE 'LOW' END,
         CASE WHEN v_effective_cache_size_mb < 1024 
              THEN 'Consider increasing effective_cache_size'
              ELSE 'Effective cache size setting is adequate' END);
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Real-time Performance Dashboard
-- ===========================================

-- Main performance dashboard function
CREATE OR REPLACE FUNCTION monitoring.performance_dashboard(
    p_time_window_hours INTEGER DEFAULT 1
)
RETURNS TABLE(
    section TEXT,
    metric TEXT,
    current_value TEXT,
    status TEXT,
    trend TEXT,
    recommendation TEXT
) AS $$
DECLARE
    v_current_tps NUMERIC;
    v_avg_response_time NUMERIC;
    v_active_connections INTEGER;
    v_cache_hit_ratio NUMERIC;
    v_slow_query_count INTEGER;
BEGIN
    -- Calculate current metrics
    SELECT 
        COUNT(*) / p_time_window_hours INTO v_current_tps
    FROM call_records 
    WHERE start_time >= CURRENT_TIMESTAMP - (p_time_window_hours || ' hours')::INTERVAL;
    
    SELECT 
        ROUND(AVG(response_time_ms), 2) INTO v_avg_response_time
    FROM call_records 
    WHERE start_time >= CURRENT_TIMESTAMP - (p_time_window_hours || ' hours')::INTERVAL
    AND response_time_ms IS NOT NULL;
    
    SELECT COUNT(*) INTO v_active_connections
    FROM pg_stat_activity 
    WHERE state = 'active' AND pid != pg_backend_pid();
    
    SELECT 
        ROUND(
            (SUM(heap_blks_hit) / NULLIF(SUM(heap_blks_hit + heap_blks_read), 0))::NUMERIC * 100, 2
        ) INTO v_cache_hit_ratio
    FROM pg_statio_user_tables;
    
    -- Return dashboard data
    RETURN QUERY VALUES 
        ('Throughput', 'Calls per Hour', 
         COALESCE(v_current_tps::TEXT, '0'),
         CASE WHEN v_current_tps > 1000 THEN 'HIGH' 
              WHEN v_current_tps > 100 THEN 'NORMAL' 
              ELSE 'LOW' END,
         'Stable', 'Monitor for capacity planning'),
         
        ('Response Time', 'Average AI Response (ms)', 
         COALESCE(v_avg_response_time::TEXT, 'N/A'),
         CASE WHEN v_avg_response_time > 2000 THEN 'CRITICAL' 
              WHEN v_avg_response_time > 1000 THEN 'WARNING' 
              ELSE 'GOOD' END,
         'Improving', 'Target: < 800ms for production'),
         
        ('Connections', 'Active Database Connections', 
         v_active_connections::TEXT,
         CASE WHEN v_active_connections > 50 THEN 'WARNING' 
              WHEN v_active_connections > 100 THEN 'CRITICAL' 
              ELSE 'GOOD' END,
         'Stable', 'Monitor connection pooling'),
         
        ('Cache', 'Buffer Cache Hit Ratio (%)', 
         COALESCE(v_cache_hit_ratio::TEXT, 'N/A'),
         CASE WHEN v_cache_hit_ratio < 90 THEN 'CRITICAL' 
              WHEN v_cache_hit_ratio < 95 THEN 'WARNING' 
              ELSE 'GOOD' END,
         'Stable', 'Target: > 95% for optimal performance');
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Performance Optimization Recommendations
-- ===========================================

-- Generate optimization recommendations
CREATE OR REPLACE FUNCTION monitoring.get_optimization_recommendations()
RETURNS TABLE(
    category TEXT,
    priority TEXT,
    recommendation TEXT,
    impact TEXT,
    effort TEXT
) AS $$
BEGIN
    -- Query optimization recommendations
    RETURN QUERY
    SELECT 
        'Query Optimization'::TEXT,
        sq.priority,
        'Optimize slow query: ' || sq.query_preview,
        CASE 
            WHEN sq.priority = 'CRITICAL' THEN 'HIGH'
            WHEN sq.priority = 'HIGH' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        'MEDIUM'::TEXT
    FROM monitoring.analyze_slow_queries(500, 5) sq;
    
    -- Index recommendations
    RETURN QUERY
    SELECT 
        'Index Optimization'::TEXT,
        mi.priority,
        'Consider adding index for table: ' || mi.table_name,
        CASE 
            WHEN mi.priority = 'HIGH' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        'LOW'::TEXT
    FROM monitoring.suggest_missing_indexes() mi
    WHERE mi.priority IN ('HIGH', 'MEDIUM')
    LIMIT 3;
    
    -- Configuration recommendations
    RETURN QUERY
    SELECT 
        'Configuration'::TEXT,
        CASE 
            WHEN cp.status = 'POOR' THEN 'HIGH'
            WHEN cp.status = 'OK' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        cp.recommendation,
        CASE 
            WHEN cp.status = 'POOR' THEN 'HIGH'
            ELSE 'MEDIUM'
        END,
        'LOW'::TEXT
    FROM monitoring.analyze_cache_performance() cp
    WHERE cp.status != 'GOOD';
    
    -- Maintenance recommendations
    RETURN QUERY
    SELECT 
        'Maintenance'::TEXT,
        CASE 
            WHEN th.maintenance_status = 'NEEDS_VACUUM' THEN 'HIGH'
            WHEN th.maintenance_status LIKE '%OVERDUE' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        'Table maintenance needed: ' || th.tablename || ' (' || th.maintenance_status || ')',
        'MEDIUM'::TEXT,
        'LOW'::TEXT
    FROM monitoring.v_table_health th
    WHERE th.maintenance_status != 'HEALTHY'
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Grant Permissions
-- ===========================================

GRANT SELECT ON ALL TABLES IN SCHEMA monitoring TO ai_ninja_readonly;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA monitoring TO ai_ninja_readonly;

RAISE NOTICE '=========================================';
RAISE NOTICE 'Performance Dashboard initialized!';
RAISE NOTICE 'Use: SELECT * FROM monitoring.performance_dashboard();';
RAISE NOTICE 'Views: v_realtime_call_performance, v_ai_model_performance';
RAISE NOTICE '=========================================';
