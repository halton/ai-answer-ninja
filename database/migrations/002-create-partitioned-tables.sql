-- AI Answer Ninja - Advanced Database Partitioning and Optimization
-- Creates time-based partitioned tables for high-volume data

BEGIN;

-- ===========================================
-- 1. Enable Required Extensions
-- ===========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ===========================================
-- 2. Call Records Partitioning (By Month)
-- ===========================================

-- Drop existing table if exists
DROP TABLE IF EXISTS call_records CASCADE;

-- Create partitioned call_records table
CREATE TABLE call_records (
    id UUID DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    caller_phone VARCHAR(20) NOT NULL,
    call_type VARCHAR(20) NOT NULL,
    call_status VARCHAR(20) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    duration_seconds INTEGER,
    azure_call_id VARCHAR(100),
    audio_recording_url TEXT,
    processing_metadata JSONB DEFAULT '{}',
    year_month INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM start_time) * 100 + EXTRACT(MONTH FROM start_time)) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, start_time)
) PARTITION BY RANGE (start_time);

-- Create partitions for current and future months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create partitions for past 3 months, current month, and future 6 months
    FOR i IN -3..6 LOOP
        start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'call_records_' || to_char(start_date, 'YYYYMM');
        
        EXECUTE format('CREATE TABLE %I PARTITION OF call_records 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
        
        -- Create indexes on each partition
        EXECUTE format('CREATE INDEX idx_%I_user_time ON %I(user_id, start_time DESC)',
                       partition_name, partition_name);
        EXECUTE format('CREATE INDEX idx_%I_caller ON %I(caller_phone, start_time DESC)',
                       partition_name, partition_name);
        EXECUTE format('CREATE INDEX idx_%I_status ON %I(call_status, start_time DESC)',
                       partition_name, partition_name);
        
        -- GIN index for JSONB metadata
        EXECUTE format('CREATE INDEX idx_%I_metadata_gin ON %I USING GIN(processing_metadata)',
                       partition_name, partition_name);
    END LOOP;
END $$;

-- ===========================================
-- 3. Conversations Partitioning (By Month)
-- ===========================================

-- Drop existing table if exists
DROP TABLE IF EXISTS conversations CASCADE;

-- Create partitioned conversations table
CREATE TABLE conversations (
    id UUID DEFAULT uuid_generate_v4(),
    call_record_id UUID NOT NULL,
    speaker VARCHAR(10) NOT NULL,
    message_text TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    confidence_score DECIMAL(3,2),
    intent_category VARCHAR(50),
    emotion VARCHAR(20),
    processing_latency INTEGER,
    year_month INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM timestamp) * 100 + EXTRACT(MONTH FROM timestamp)) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create conversation partitions
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN -3..6 LOOP
        start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'conversations_' || to_char(start_date, 'YYYYMM');
        
        EXECUTE format('CREATE TABLE %I PARTITION OF conversations 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
        
        -- Indexes for conversations
        EXECUTE format('CREATE INDEX idx_%I_call_time ON %I(call_record_id, timestamp)',
                       partition_name, partition_name);
        EXECUTE format('CREATE INDEX idx_%I_intent ON %I(intent_category, timestamp DESC)',
                       partition_name, partition_name);
        EXECUTE format('CREATE INDEX idx_%I_text_search ON %I USING GIN(to_tsvector(''simple'', message_text))',
                       partition_name, partition_name);
    END LOOP;
END $$;

-- ===========================================
-- 4. Advanced Indexing Strategy
-- ===========================================

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_call_records_user_status_time 
ON call_records(user_id, call_status, start_time DESC) 
WHERE start_time >= CURRENT_DATE - INTERVAL '30 days';

-- Partial indexes for active data only
CREATE INDEX CONCURRENTLY idx_call_records_active_calls 
ON call_records(user_id, start_time DESC) 
WHERE call_status IN ('answered', 'in_progress') 
AND start_time >= CURRENT_DATE - INTERVAL '7 days';

-- Expression index for phone number normalization
CREATE INDEX CONCURRENTLY idx_call_records_normalized_phone
ON call_records(user_id, regexp_replace(caller_phone, '[^0-9]', '', 'g'));

-- ===========================================
-- 5. Performance Functions
-- ===========================================

-- Function to get call statistics with optimal performance
CREATE OR REPLACE FUNCTION get_call_stats(
    p_user_id UUID,
    p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date DATE DEFAULT CURRENT_DATE + INTERVAL '1 day'
) RETURNS TABLE (
    total_calls BIGINT,
    answered_calls BIGINT,
    blocked_calls BIGINT,
    average_duration NUMERIC,
    top_spam_categories TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH call_summary AS (
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE call_status = 'answered') as answered,
            COUNT(*) FILTER (WHERE call_status = 'blocked') as blocked,
            AVG(duration_seconds) as avg_duration
        FROM call_records cr
        WHERE cr.user_id = p_user_id 
        AND cr.start_time >= p_start_date 
        AND cr.start_time < p_end_date
    ),
    spam_categories AS (
        SELECT ARRAY_AGG(intent_category ORDER BY category_count DESC) as categories
        FROM (
            SELECT 
                c.intent_category,
                COUNT(*) as category_count
            FROM conversations c
            JOIN call_records cr ON c.call_record_id = cr.id
            WHERE cr.user_id = p_user_id 
            AND c.timestamp >= p_start_date 
            AND c.timestamp < p_end_date
            AND c.intent_category IS NOT NULL
            GROUP BY c.intent_category
            ORDER BY category_count DESC
            LIMIT 5
        ) t
    )
    SELECT 
        cs.total,
        cs.answered,
        cs.blocked,
        ROUND(cs.avg_duration, 2),
        COALESCE(sc.categories, ARRAY[]::TEXT[])
    FROM call_summary cs
    CROSS JOIN spam_categories sc;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 6. Automated Partition Management
-- ===========================================

-- Function to create future partitions
CREATE OR REPLACE FUNCTION create_monthly_partitions()
RETURNS void AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    table_names TEXT[] := ARRAY['call_records', 'conversations'];
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY table_names LOOP
        -- Create partition for next 3 months
        FOR i IN 1..3 LOOP
            start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
            end_date := start_date + INTERVAL '1 month';
            partition_name := table_name || '_' || to_char(start_date, 'YYYYMM');
            
            -- Check if partition already exists
            IF NOT EXISTS (
                SELECT 1 FROM pg_tables 
                WHERE tablename = partition_name 
                AND schemaname = 'public'
            ) THEN
                EXECUTE format('CREATE TABLE %I PARTITION OF %I 
                               FOR VALUES FROM (%L) TO (%L)',
                               partition_name, table_name, start_date, end_date);
                
                -- Create appropriate indexes based on table
                IF table_name = 'call_records' THEN
                    EXECUTE format('CREATE INDEX idx_%I_user_time ON %I(user_id, start_time DESC)',
                                   partition_name, partition_name);
                    EXECUTE format('CREATE INDEX idx_%I_caller ON %I(caller_phone, start_time DESC)',
                                   partition_name, partition_name);
                    EXECUTE format('CREATE INDEX idx_%I_metadata_gin ON %I USING GIN(processing_metadata)',
                                   partition_name, partition_name);
                ELSIF table_name = 'conversations' THEN
                    EXECUTE format('CREATE INDEX idx_%I_call_time ON %I(call_record_id, timestamp)',
                                   partition_name, partition_name);
                    EXECUTE format('CREATE INDEX idx_%I_intent ON %I(intent_category, timestamp DESC)',
                                   partition_name, partition_name);
                    EXECUTE format('CREATE INDEX idx_%I_text_search ON %I USING GIN(to_tsvector(''simple'', message_text))',
                                   partition_name, partition_name);
                END IF;
                
                RAISE NOTICE 'Created partition: %', partition_name;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions (older than 6 months)
CREATE OR REPLACE FUNCTION cleanup_old_partitions()
RETURNS void AS $$
DECLARE
    cutoff_date DATE := CURRENT_DATE - INTERVAL '6 months';
    partition_name TEXT;
    table_names TEXT[] := ARRAY['call_records', 'conversations'];
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY table_names LOOP
        FOR partition_name IN 
            SELECT tablename 
            FROM pg_tables 
            WHERE tablename LIKE table_name || '_%'
            AND schemaname = 'public'
            AND substring(tablename from '([0-9]{6})$')::INTEGER < 
                EXTRACT(YEAR FROM cutoff_date) * 100 + EXTRACT(MONTH FROM cutoff_date)
        LOOP
            EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
            RAISE NOTICE 'Dropped old partition: %', partition_name;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 7. Performance Monitoring Views
-- ===========================================

-- View for partition information
CREATE VIEW partition_info AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    (xpath('//text()', pg_get_expr(c.relpartbound, c.oid)))[1]::text as partition_bounds
FROM pg_tables pt
JOIN pg_class c ON c.relname = pt.tablename
WHERE pt.tablename LIKE 'call_records_%' 
   OR pt.tablename LIKE 'conversations_%'
ORDER BY pt.tablename;

-- View for query performance statistics
CREATE VIEW query_performance AS
SELECT 
    substring(query, 1, 100) as query_preview,
    calls,
    total_time,
    mean_time,
    min_time,
    max_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_time DESC
LIMIT 20;

-- ===========================================
-- 8. Maintenance Procedures
-- ===========================================

-- Schedule partition management (requires pg_cron extension)
-- SELECT cron.schedule('create-partitions', '0 0 1 * *', 'SELECT create_monthly_partitions();');
-- SELECT cron.schedule('cleanup-partitions', '0 2 1 * *', 'SELECT cleanup_old_partitions();');

-- Create maintenance function that can be called manually
CREATE OR REPLACE FUNCTION maintain_database()
RETURNS void AS $$
BEGIN
    -- Update statistics
    ANALYZE;
    
    -- Create future partitions
    PERFORM create_monthly_partitions();
    
    -- Cleanup old partitions (if needed)
    -- PERFORM cleanup_old_partitions();
    
    -- Log maintenance
    INSERT INTO system_logs (level, message, created_at) 
    VALUES ('INFO', 'Database maintenance completed', CURRENT_TIMESTAMP);
    
    RAISE NOTICE 'Database maintenance completed at %', CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

COMMIT;