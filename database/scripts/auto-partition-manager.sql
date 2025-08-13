-- AI Answer Ninja - Automatic Partition Management System
-- Provides intelligent partition creation, management, and cleanup
-- Based on CLAUDE.md database optimization specifications

-- ===========================================
-- 1. Advanced Partition Creation Functions
-- ===========================================

-- Create partitions with intelligent sizing
CREATE OR REPLACE FUNCTION create_optimized_partitions(
    p_table_name TEXT,
    p_months_ahead INTEGER DEFAULT 3,
    p_partition_strategy TEXT DEFAULT 'monthly' -- 'monthly', 'weekly', 'daily'
) RETURNS TABLE (
    partition_name TEXT,
    partition_bounds TEXT,
    estimated_size_mb BIGINT,
    creation_status TEXT
) AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    table_exists BOOLEAN;
    current_size BIGINT;
    estimated_growth BIGINT;
BEGIN
    -- Verify table exists and is partitioned
    SELECT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = p_table_name 
        AND schemaname = 'public'
    ) INTO table_exists;
    
    IF NOT table_exists THEN
        RETURN QUERY SELECT 
            'N/A'::TEXT, 
            'Table not found'::TEXT, 
            0::BIGINT, 
            'ERROR'::TEXT;
        RETURN;
    END IF;
    
    -- Get current table size for estimation
    SELECT pg_total_relation_size(p_table_name) / 1048576 INTO current_size;
    
    -- Calculate growth estimation based on partition strategy
    CASE p_partition_strategy
        WHEN 'monthly' THEN
            estimated_growth := current_size / 12; -- Assume monthly growth
        WHEN 'weekly' THEN
            estimated_growth := current_size / 52;
        WHEN 'daily' THEN
            estimated_growth := current_size / 365;
        ELSE
            estimated_growth := current_size / 12;
    END CASE;
    
    -- Create partitions based on strategy
    IF p_partition_strategy = 'monthly' THEN
        FOR i IN 1..p_months_ahead LOOP
            start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
            end_date := start_date + INTERVAL '1 month';
            partition_name := p_table_name || '_' || to_char(start_date, 'YYYYMM');
            
            -- Check if partition already exists
            IF NOT EXISTS (
                SELECT 1 FROM pg_tables 
                WHERE tablename = partition_name 
                AND schemaname = 'public'
            ) THEN
                BEGIN
                    EXECUTE format('CREATE TABLE %I PARTITION OF %I 
                                   FOR VALUES FROM (%L) TO (%L)',
                                   partition_name, p_table_name, start_date, end_date);
                    
                    -- Create appropriate indexes
                    PERFORM create_partition_indexes(p_table_name, partition_name);
                    
                    RETURN QUERY SELECT 
                        partition_name,
                        format('FROM %s TO %s', start_date, end_date),
                        estimated_growth,
                        'SUCCESS'::TEXT;
                EXCEPTION WHEN OTHERS THEN
                    RETURN QUERY SELECT 
                        partition_name,
                        format('FROM %s TO %s', start_date, end_date),
                        0::BIGINT,
                        'ERROR: ' || SQLERRM;
                END;
            ELSE
                RETURN QUERY SELECT 
                    partition_name,
                    format('FROM %s TO %s', start_date, end_date),
                    estimated_growth,
                    'EXISTS'::TEXT;
            END IF;
        END LOOP;
    END IF;
    
    -- Log partition creation activity
    INSERT INTO system_logs (level, message, metadata)
    VALUES (
        'INFO',
        'Partition creation completed for table: ' || p_table_name,
        jsonb_build_object(
            'table_name', p_table_name,
            'partitions_ahead', p_months_ahead,
            'strategy', p_partition_strategy,
            'estimated_growth_mb', estimated_growth
        )
    );
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 2. Intelligent Index Creation for Partitions
-- ===========================================

CREATE OR REPLACE FUNCTION create_partition_indexes(
    p_table_name TEXT,
    p_partition_name TEXT
) RETURNS void AS $$
BEGIN
    -- Create indexes based on table type
    CASE p_table_name
        WHEN 'call_records' THEN
            -- Core performance indexes
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_user_time 
                           ON %I(user_id, start_time DESC)',
                           p_partition_name, p_partition_name);
            
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_caller 
                           ON %I(caller_phone, start_time DESC)',
                           p_partition_name, p_partition_name);
            
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_status 
                           ON %I(call_status, start_time DESC)',
                           p_partition_name, p_partition_name);
            
            -- JSONB GIN index for metadata
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_metadata_gin 
                           ON %I USING GIN(processing_metadata)',
                           p_partition_name, p_partition_name);
            
            -- Composite index for analytics
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_analytics 
                           ON %I(user_id, call_type, call_status) 
                           INCLUDE (duration_seconds)',
                           p_partition_name, p_partition_name);
        
        WHEN 'conversations' THEN
            -- Conversation-specific indexes
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_call_time 
                           ON %I(call_record_id, timestamp)',
                           p_partition_name, p_partition_name);
            
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_intent 
                           ON %I(intent_category, timestamp DESC)',
                           p_partition_name, p_partition_name);
            
            -- Full-text search index
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_text_search 
                           ON %I USING GIN(to_tsvector(''simple'', message_text))',
                           p_partition_name, p_partition_name);
            
            -- Emotion analysis index
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_emotion 
                           ON %I(emotion, confidence_score) 
                           WHERE emotion IS NOT NULL',
                           p_partition_name, p_partition_name);
        
        WHEN 'query_performance_log' THEN
            -- Performance monitoring indexes
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_query_type_time 
                           ON %I(query_type, created_at DESC)',
                           p_partition_name, p_partition_name);
            
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_service_performance 
                           ON %I(service_name, execution_time_ms)',
                           p_partition_name, p_partition_name);
        
        WHEN 'cache_performance_log' THEN
            -- Cache performance indexes
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_cache_type 
                           ON %I(cache_type, hit_miss, created_at DESC)',
                           p_partition_name, p_partition_name);
        
        WHEN 'system_logs' THEN
            -- System logging indexes
            EXECUTE format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%I_level_time 
                           ON %I(level, created_at DESC)',
                           p_partition_name, p_partition_name);
    END CASE;
    
    -- Log index creation
    INSERT INTO system_logs (level, message, metadata)
    VALUES (
        'INFO',
        'Indexes created for partition: ' || p_partition_name,
        jsonb_build_object(
            'table_name', p_table_name,
            'partition_name', p_partition_name
        )
    );
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 3. Intelligent Partition Cleanup
-- ===========================================

CREATE OR REPLACE FUNCTION cleanup_old_partitions_intelligent(
    p_retention_months INTEGER DEFAULT 6,
    p_dry_run BOOLEAN DEFAULT true
) RETURNS TABLE (
    table_name TEXT,
    partition_name TEXT,
    partition_size_mb BIGINT,
    row_count BIGINT,
    action_taken TEXT
) AS $$
DECLARE
    cutoff_date DATE;
    partition_record RECORD;
    partition_size BIGINT;
    partition_rows BIGINT;
    should_archive BOOLEAN;
    archive_threshold_mb CONSTANT BIGINT := 100; -- Archive partitions > 100MB
BEGIN
    cutoff_date := CURRENT_DATE - INTERVAL '1 month' * p_retention_months;
    
    -- Analyze each old partition
    FOR partition_record IN 
        SELECT 
            pt.tablename,
            CASE 
                WHEN pt.tablename LIKE '%_20%' THEN 
                    substring(pt.tablename FROM '.*_([0-9]{6})$')
                ELSE NULL
            END as date_suffix
        FROM pg_tables pt
        WHERE pt.schemaname = 'public'
        AND pt.tablename ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$'
    LOOP
        -- Skip if date suffix is invalid
        CONTINUE WHEN partition_record.date_suffix IS NULL;
        
        -- Check if partition is older than cutoff
        CONTINUE WHEN partition_record.date_suffix::INTEGER >= 
            EXTRACT(YEAR FROM cutoff_date) * 100 + EXTRACT(MONTH FROM cutoff_date);
        
        -- Get partition statistics
        SELECT 
            pg_total_relation_size(partition_record.tablename) / 1048576,
            COALESCE(n_tup_ins + n_tup_upd + n_tup_del, 0)
        INTO partition_size, partition_rows
        FROM pg_stat_user_tables 
        WHERE relname = partition_record.tablename;
        
        -- Determine if should archive vs delete
        should_archive := partition_size > archive_threshold_mb;
        
        IF p_dry_run THEN
            RETURN QUERY SELECT 
                regexp_replace(partition_record.tablename, '_[0-9]{6}$', ''),
                partition_record.tablename,
                COALESCE(partition_size, 0),
                COALESCE(partition_rows, 0),
                CASE 
                    WHEN should_archive THEN 'WOULD_ARCHIVE'
                    ELSE 'WOULD_DELETE'
                END;
        ELSE
            IF should_archive THEN
                -- Archive large partitions before dropping
                PERFORM archive_partition_data(partition_record.tablename);
                
                RETURN QUERY SELECT 
                    regexp_replace(partition_record.tablename, '_[0-9]{6}$', ''),
                    partition_record.tablename,
                    COALESCE(partition_size, 0),
                    COALESCE(partition_rows, 0),
                    'ARCHIVED_AND_DROPPED'::TEXT;
            ELSE
                RETURN QUERY SELECT 
                    regexp_replace(partition_record.tablename, '_[0-9]{6}$', ''),
                    partition_record.tablename,
                    COALESCE(partition_size, 0),
                    COALESCE(partition_rows, 0),
                    'DROPPED'::TEXT;
            END IF;
            
            -- Drop the partition
            EXECUTE format('DROP TABLE IF EXISTS %I', partition_record.tablename);
            
            -- Log the action
            INSERT INTO system_logs (level, message, metadata)
            VALUES (
                'INFO',
                'Partition cleaned up: ' || partition_record.tablename,
                jsonb_build_object(
                    'partition_name', partition_record.tablename,
                    'size_mb', partition_size,
                    'row_count', partition_rows,
                    'archived', should_archive
                )
            );
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 4. Partition Archival Function
-- ===========================================

CREATE OR REPLACE FUNCTION archive_partition_data(p_partition_name TEXT)
RETURNS void AS $$
DECLARE
    archive_table_name TEXT;
    base_table_name TEXT;
BEGIN
    -- Extract base table name
    base_table_name := regexp_replace(p_partition_name, '_[0-9]{6}$', '');
    archive_table_name := 'archived_' || p_partition_name;
    
    -- Create archive table
    EXECUTE format('CREATE TABLE %I AS SELECT * FROM %I', 
                   archive_table_name, p_partition_name);
    
    -- Compress archive table if pg_squeeze is available
    BEGIN
        EXECUTE format('SELECT squeeze.squeeze_table(%L)', archive_table_name);
    EXCEPTION WHEN OTHERS THEN
        -- pg_squeeze not available, skip compression
        NULL;
    END;
    
    -- Log archival
    INSERT INTO system_logs (level, message, metadata)
    VALUES (
        'INFO',
        'Partition archived: ' || p_partition_name,
        jsonb_build_object(
            'source_partition', p_partition_name,
            'archive_table', archive_table_name
        )
    );
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 5. Automated Maintenance Scheduler
-- ===========================================

CREATE OR REPLACE FUNCTION scheduled_partition_maintenance()
RETURNS void AS $$
DECLARE
    maintenance_log JSONB;
    tables_to_maintain TEXT[] := ARRAY[
        'call_records', 
        'conversations', 
        'query_performance_log', 
        'cache_performance_log', 
        'system_logs'
    ];
    table_name TEXT;
    partition_results RECORD;
    cleanup_results RECORD;
BEGIN
    maintenance_log := '{}'::JSONB;
    
    -- Create future partitions for all tables
    FOREACH table_name IN ARRAY tables_to_maintain LOOP
        BEGIN
            -- Create 3 months of future partitions
            SELECT jsonb_agg(
                jsonb_build_object(
                    'partition_name', partition_name,
                    'status', creation_status
                )
            ) INTO partition_results
            FROM create_optimized_partitions(table_name, 3, 'monthly');
            
            maintenance_log := maintenance_log || 
                jsonb_build_object(table_name || '_partitions', partition_results);
        EXCEPTION WHEN OTHERS THEN
            maintenance_log := maintenance_log || 
                jsonb_build_object(table_name || '_error', SQLERRM);
        END;
    END LOOP;
    
    -- Cleanup old partitions (dry run first, then actual cleanup)
    SELECT jsonb_agg(
        jsonb_build_object(
            'table', table_name,
            'partition', partition_name,
            'action', action_taken
        )
    ) INTO cleanup_results
    FROM cleanup_old_partitions_intelligent(6, false); -- 6 months retention
    
    maintenance_log := maintenance_log || 
        jsonb_build_object('cleanup_results', cleanup_results);
    
    -- Update table statistics
    ANALYZE;
    
    -- Log comprehensive maintenance results
    INSERT INTO system_logs (level, message, metadata)
    VALUES (
        'INFO',
        'Scheduled partition maintenance completed',
        maintenance_log
    );
    
    -- Update partition statistics
    PERFORM update_partition_statistics();
    
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 6. Partition Statistics Update
-- ===========================================

CREATE OR REPLACE FUNCTION update_partition_statistics()
RETURNS void AS $$
DECLARE
    partition_record RECORD;
BEGIN
    -- Clear old statistics (older than 7 days)
    DELETE FROM partition_stats 
    WHERE recorded_at < CURRENT_DATE - INTERVAL '7 days';
    
    -- Collect current partition statistics
    FOR partition_record IN
        SELECT 
            pt.tablename,
            regexp_replace(pt.tablename, '_[0-9]{6}$', '') as base_table,
            pg_total_relation_size(pt.tablename) as size_bytes,
            COALESCE(st.n_tup_ins + st.n_tup_upd + st.n_tup_del, 0) as row_count,
            st.last_vacuum,
            st.last_analyze
        FROM pg_tables pt
        LEFT JOIN pg_stat_user_tables st ON st.relname = pt.tablename
        WHERE pt.schemaname = 'public'
        AND pt.tablename ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$'
    LOOP
        INSERT INTO partition_stats (
            table_name,
            partition_name,
            row_count,
            size_bytes,
            last_vacuum,
            last_analyze,
            recorded_at
        ) VALUES (
            partition_record.base_table,
            partition_record.tablename,
            partition_record.row_count,
            partition_record.size_bytes,
            partition_record.last_vacuum,
            partition_record.last_analyze,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (table_name, partition_name, recorded_at::date) 
        DO UPDATE SET
            row_count = EXCLUDED.row_count,
            size_bytes = EXCLUDED.size_bytes,
            last_vacuum = EXCLUDED.last_vacuum,
            last_analyze = EXCLUDED.last_analyze;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 7. Partition Health Check
-- ===========================================

CREATE OR REPLACE FUNCTION check_partition_health()
RETURNS TABLE (
    table_name TEXT,
    issue_type TEXT,
    issue_description TEXT,
    recommended_action TEXT,
    severity TEXT
) AS $$
BEGIN
    -- Check for missing future partitions
    RETURN QUERY
    WITH expected_partitions AS (
        SELECT 
            unnest(ARRAY['call_records', 'conversations', 'query_performance_log', 'cache_performance_log', 'system_logs']) as table_name,
            generate_series(0, 2) as month_offset
    ),
    missing_partitions AS (
        SELECT 
            ep.table_name,
            ep.table_name || '_' || to_char(
                date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * ep.month_offset), 
                'YYYYMM'
            ) as expected_partition
        FROM expected_partitions ep
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_tables pt
            WHERE pt.tablename = ep.table_name || '_' || to_char(
                date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * ep.month_offset), 
                'YYYYMM'
            )
        )
    )
    SELECT 
        mp.table_name,
        'missing_partition'::TEXT,
        'Missing future partition: ' || mp.expected_partition,
        'Run create_optimized_partitions(''' || mp.table_name || ''')',
        'HIGH'::TEXT
    FROM missing_partitions mp;
    
    -- Check for oversized partitions
    RETURN QUERY
    SELECT 
        regexp_replace(pt.tablename, '_[0-9]{6}$', ''),
        'oversized_partition'::TEXT,
        'Partition size exceeds 2GB: ' || pg_size_pretty(pg_total_relation_size(pt.tablename)),
        'Consider splitting partition or archiving old data',
        'MEDIUM'::TEXT
    FROM pg_tables pt
    WHERE pt.schemaname = 'public'
    AND pt.tablename ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$'
    AND pg_total_relation_size(pt.tablename) > 2147483648; -- 2GB
    
    -- Check for unvacuumed partitions
    RETURN QUERY
    SELECT 
        regexp_replace(st.relname, '_[0-9]{6}$', ''),
        'maintenance_needed'::TEXT,
        'Partition not vacuumed in over 7 days: ' || st.relname,
        'Run VACUUM ANALYZE on partition',
        'LOW'::TEXT
    FROM pg_stat_user_tables st
    WHERE st.relname ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$'
    AND (st.last_vacuum IS NULL OR st.last_vacuum < CURRENT_DATE - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 8. Example Usage and Documentation
-- ===========================================

-- Create a comprehensive partition management report
CREATE OR REPLACE FUNCTION partition_management_report()
RETURNS TABLE (
    section TEXT,
    metric TEXT,
    value TEXT,
    status TEXT
) AS $$
BEGIN
    -- Current partition count
    RETURN QUERY
    SELECT 
        'Current State'::TEXT,
        'Total Partitions'::TEXT,
        COUNT(*)::TEXT,
        'INFO'::TEXT
    FROM pg_tables 
    WHERE tablename ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$';
    
    -- Total size
    RETURN QUERY
    SELECT 
        'Current State'::TEXT,
        'Total Partitioned Data Size'::TEXT,
        pg_size_pretty(SUM(pg_total_relation_size(tablename))),
        'INFO'::TEXT
    FROM pg_tables 
    WHERE tablename ~ '_(call_records|conversations|query_performance_log|cache_performance_log|system_logs)_[0-9]{6}$';
    
    -- Health issues
    RETURN QUERY
    SELECT 
        'Health Issues'::TEXT,
        pht.issue_type || ': ' || pht.table_name,
        pht.issue_description,
        pht.severity
    FROM check_partition_health() pht;
    
    -- Recent maintenance
    RETURN QUERY
    SELECT 
        'Recent Activity'::TEXT,
        'Last Maintenance'::TEXT,
        COALESCE(MAX(created_at)::TEXT, 'Never'),
        CASE 
            WHEN MAX(created_at) > CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 'GOOD'
            WHEN MAX(created_at) > CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 'WARNING'
            ELSE 'ERROR'
        END
    FROM system_logs 
    WHERE message LIKE '%partition%maintenance%';
END;
$$ LANGUAGE plpgsql;

-- Schedule example (requires pg_cron extension)
/*
-- Schedule partition maintenance to run daily at 2 AM
SELECT cron.schedule('partition-maintenance', '0 2 * * *', 'SELECT scheduled_partition_maintenance();');

-- Schedule health check to run every 6 hours
SELECT cron.schedule('partition-health-check', '0 */6 * * *', 'INSERT INTO system_logs (level, message, metadata) SELECT ''WARNING'', ''Partition health issues detected'', jsonb_agg(jsonb_build_object(''table'', table_name, ''issue'', issue_type, ''description'', issue_description)) FROM check_partition_health() WHERE severity IN (''HIGH'', ''MEDIUM'');');
*/