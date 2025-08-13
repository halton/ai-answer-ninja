-- AI Answer Ninja - Redis Initialization Script
-- Setup Redis databases and initial data structures

-- ===========================================
-- Database Setup and Key Initialization
-- ===========================================

-- Function to setup database structures
local function setup_database(db_num, db_name, initial_data)
    redis.call('SELECT', db_num)
    
    -- Clear database if in development mode
    if ARGV[1] == 'development' then
        redis.call('FLUSHDB')
    end
    
    -- Set database metadata
    redis.call('HSET', 'db:meta', 
        'name', db_name,
        'initialized_at', os.time(),
        'version', '1.0',
        'purpose', initial_data.purpose or 'General use'
    )
    
    -- Initialize data structures if provided
    if initial_data.keys then
        for key, value in pairs(initial_data.keys) do
            if type(value) == 'table' then
                -- Handle hash data
                if value.type == 'hash' then
                    for field, val in pairs(value.data) do
                        redis.call('HSET', key, field, val)
                    end
                    if value.ttl then
                        redis.call('EXPIRE', key, value.ttl)
                    end
                -- Handle set data
                elseif value.type == 'set' then
                    for _, member in ipairs(value.data) do
                        redis.call('SADD', key, member)
                    end
                    if value.ttl then
                        redis.call('EXPIRE', key, value.ttl)
                    end
                -- Handle sorted set data
                elseif value.type == 'zset' then
                    for _, item in ipairs(value.data) do
                        redis.call('ZADD', key, item.score, item.member)
                    end
                    if value.ttl then
                        redis.call('EXPIRE', key, value.ttl)
                    end
                -- Handle list data
                elseif value.type == 'list' then
                    for _, item in ipairs(value.data) do
                        redis.call('RPUSH', key, item)
                    end
                    if value.ttl then
                        redis.call('EXPIRE', key, value.ttl)
                    end
                end
            else
                -- Handle string data
                redis.call('SET', key, value)
            end
        end
    end
    
    return 'Database ' .. db_num .. ' (' .. db_name .. ') initialized'
end

-- ===========================================
-- Database 0: User Sessions and Authentication
-- ===========================================

local db0_data = {
    purpose = 'User sessions, authentication tokens, and login state',
    keys = {
        ['config:session:default_ttl'] = '3600',  -- 1 hour
        ['config:session:max_ttl'] = '86400',     -- 24 hours
        ['config:auth:max_attempts'] = '5',
        ['config:auth:lockout_duration'] = '900', -- 15 minutes
        ['stats:sessions:active'] = {
            type = 'hash',
            data = {
                count = '0',
                last_updated = tostring(os.time())
            }
        }
    }
}

setup_database(0, 'user_sessions', db0_data)

-- ===========================================
-- Database 1: Call Processing Cache (Real-time)
-- ===========================================

local db1_data = {
    purpose = 'Real-time call processing state and temporary data',
    keys = {
        ['config:call:max_duration'] = '300',     -- 5 minutes
        ['config:call:response_timeout'] = '30',  -- 30 seconds
        ['config:processing:queue_limit'] = '1000',
        ['stats:calls:processing'] = {
            type = 'hash',
            data = {
                active_count = '0',
                queue_length = '0',
                last_updated = tostring(os.time())
            }
        },
        ['queue:call_processing'] = {
            type = 'list',
            data = {}
        }
    }
}

setup_database(1, 'call_processing', db1_data)

-- ===========================================
-- Database 2: User Profiles and Preferences
-- ===========================================

local db2_data = {
    purpose = 'User profile cache and preference storage',
    keys = {
        ['config:profile:cache_ttl'] = '7200',    -- 2 hours
        ['config:profile:max_size'] = '1048576',  -- 1MB
        ['stats:profiles:cached'] = {
            type = 'hash',
            data = {
                count = '0',
                hit_rate = '0.0',
                last_updated = tostring(os.time())
            }
        },
        ['index:profile:by_phone'] = {
            type = 'hash',
            data = {}
        }
    }
}

setup_database(2, 'user_profiles', db2_data)

-- ===========================================
-- Database 3: Whitelist Cache
-- ===========================================

local db3_data = {
    purpose = 'Smart whitelist cache for fast lookup',
    keys = {
        ['config:whitelist:cache_ttl'] = '1800',  -- 30 minutes
        ['config:whitelist:preload_limit'] = '10000',
        ['stats:whitelist:performance'] = {
            type = 'hash',
            data = {
                hit_rate = '0.0',
                miss_rate = '0.0',
                last_updated = tostring(os.time())
            }
        },
        ['index:whitelist:active'] = {
            type = 'set',
            data = {}
        }
    }
}

setup_database(3, 'whitelist_cache', db3_data)

-- ===========================================
-- Database 4: AI Response Cache
-- ===========================================

local db4_data = {
    purpose = 'AI-generated response cache for performance optimization',
    keys = {
        ['config:ai_cache:ttl'] = '3600',         -- 1 hour
        ['config:ai_cache:max_responses'] = '50000',
        ['config:ai_cache:compression'] = 'gzip',
        ['stats:ai_cache:performance'] = {
            type = 'hash',
            data = {
                hit_rate = '0.0',
                response_count = '0',
                avg_generation_time = '0',
                last_updated = tostring(os.time())
            }
        },
        ['index:ai_responses:by_intent'] = {
            type = 'hash',
            data = {}
        }
    }
}

setup_database(4, 'ai_response_cache', db4_data)

-- ===========================================
-- Database 5: Performance Metrics and Monitoring
-- ===========================================

local db5_data = {
    purpose = 'Real-time performance metrics and monitoring data',
    keys = {
        ['config:metrics:retention'] = '604800',  -- 7 days
        ['config:metrics:collection_interval'] = '60', -- 1 minute
        ['metrics:system:current'] = {
            type = 'hash',
            data = {
                cpu_usage = '0.0',
                memory_usage = '0.0',
                active_connections = '0',
                last_updated = tostring(os.time())
            }
        },
        ['metrics:performance:realtime'] = {
            type = 'zset',
            data = {}
        }
    }
}

setup_database(5, 'performance_metrics', db5_data)

-- ===========================================
-- Database 6: Rate Limiting and Security
-- ===========================================

local db6_data = {
    purpose = 'Rate limiting, security monitoring, and access control',
    keys = {
        ['config:ratelimit:default_limit'] = '100',   -- 100 requests per window
        ['config:ratelimit:window_size'] = '3600',    -- 1 hour window
        ['config:security:max_failed_attempts'] = '10',
        ['config:security:ban_duration'] = '7200',    -- 2 hours
        ['security:blocked_ips'] = {
            type = 'set',
            data = {}
        },
        ['security:suspicious_activity'] = {
            type = 'zset',
            data = {}
        }
    }
}

setup_database(6, 'rate_limiting_security', db6_data)

-- ===========================================
-- Database 7: Background Job Queues
-- ===========================================

local db7_data = {
    purpose = 'Background job queues and task processing',
    keys = {
        ['config:queue:max_jobs'] = '10000',
        ['config:queue:retry_attempts'] = '3',
        ['config:queue:job_timeout'] = '300',     -- 5 minutes
        ['queue:high_priority'] = {
            type = 'list',
            data = {}
        },
        ['queue:normal_priority'] = {
            type = 'list',
            data = {}
        },
        ['queue:low_priority'] = {
            type = 'list',
            data = {}
        },
        ['jobs:processing'] = {
            type = 'hash',
            data = {}
        },
        ['jobs:failed'] = {
            type = 'list',
            data = {}
        }
    }
}

setup_database(7, 'background_jobs', db7_data)

-- ===========================================
-- Database 8: Analytics and Reporting Cache
-- ===========================================

local db8_data = {
    purpose = 'Analytics data cache and reporting aggregations',
    keys = {
        ['config:analytics:cache_ttl'] = '14400',     -- 4 hours
        ['config:analytics:max_reports'] = '1000',
        ['analytics:daily_stats'] = {
            type = 'hash',
            data = {
                total_calls = '0',
                successful_calls = '0',
                failed_calls = '0',
                avg_response_time = '0',
                last_updated = tostring(os.time())
            }
        },
        ['analytics:hourly_metrics'] = {
            type = 'zset',
            data = {}
        }
    }
}

setup_database(8, 'analytics_cache', db8_data)

-- ===========================================
-- Database 9: Configuration Cache
-- ===========================================

local db9_data = {
    purpose = 'Application configuration cache and feature flags',
    keys = {
        ['config:app:cache_ttl'] = '1800',        -- 30 minutes
        ['config:features:ai_response_caching'] = 'true',
        ['config:features:real_time_analytics'] = 'true',
        ['config:features:smart_whitelist'] = 'true',
        ['config:features:advanced_monitoring'] = 'true',
        ['feature_flags'] = {
            type = 'hash',
            data = {
                enable_ai_learning = 'true',
                enable_performance_optimization = 'true',
                enable_advanced_security = 'true',
                maintenance_mode = 'false'
            }
        },
        ['app_config:global'] = {
            type = 'hash',
            data = {
                max_concurrent_calls = '1000',
                ai_response_timeout = '5000',
                cache_warm_up_enabled = 'true',
                last_updated = tostring(os.time())
            }
        }
    }
}

setup_database(9, 'configuration_cache', db9_data)

-- ===========================================
-- Setup Health Check Keys
-- ===========================================

-- Switch back to database 0 for global health checks
redis.call('SELECT', 0)

-- System health check key
redis.call('HSET', 'system:health', 
    'status', 'healthy',
    'last_check', os.time(),
    'version', '1.0',
    'initialized', 'true'
)

-- Database status overview
local db_status = {}
for i = 0, 9 do
    db_status['db_' .. i] = 'initialized'
end

redis.call('HMSET', 'system:database_status', unpack(db_status))

-- Performance tracking
redis.call('HSET', 'system:performance',
    'total_operations', '0',
    'avg_response_time', '0',
    'peak_memory_usage', '0',
    'last_updated', os.time()
)

-- ===========================================
-- Initialize Monitoring Streams
-- ===========================================

-- Create monitoring streams for real-time metrics
redis.call('SELECT', 5)  -- Performance metrics database

-- Initialize metric streams
local current_time = os.time() * 1000  -- Convert to milliseconds

-- System metrics stream
redis.call('XADD', 'stream:system_metrics', '*',
    'cpu_usage', '0.0',
    'memory_usage', '0.0',
    'disk_usage', '0.0',
    'network_io', '0.0',
    'timestamp', current_time
)

-- Application metrics stream
redis.call('XADD', 'stream:app_metrics', '*',
    'active_calls', '0',
    'calls_per_minute', '0',
    'avg_response_time', '0',
    'cache_hit_rate', '0.0',
    'timestamp', current_time
)

-- Error tracking stream
redis.call('XADD', 'stream:error_tracking', '*',
    'error_count', '0',
    'critical_errors', '0',
    'warnings', '0',
    'timestamp', current_time
)

-- ===========================================
-- Setup Expiration Policies
-- ===========================================

-- Switch to each database and set up TTL for temporary keys
for db = 0, 9 do
    redis.call('SELECT', db)
    
    -- Set TTL for temporary or cache keys based on database purpose
    local ttl_patterns = {
        [0] = {'session:*', 3600},          -- Sessions expire after 1 hour
        [1] = {'call:temp:*', 300},         -- Temporary call data expires after 5 minutes
        [2] = {'profile:cache:*', 7200},    -- Profile cache expires after 2 hours
        [3] = {'whitelist:cache:*', 1800},  -- Whitelist cache expires after 30 minutes
        [4] = {'ai:response:*', 3600},      -- AI responses expire after 1 hour
        [5] = {'metrics:temp:*', 604800},   -- Temporary metrics expire after 7 days
        [6] = {'ratelimit:*', 3600},        -- Rate limit counters expire after 1 hour
        [7] = {'job:temp:*', 3600},         -- Temporary job data expires after 1 hour
        [8] = {'analytics:temp:*', 14400},  -- Temporary analytics expire after 4 hours
        [9] = {'config:temp:*', 1800}       -- Temporary config expires after 30 minutes
    }
    
    -- Note: In a real implementation, we would set up these TTL patterns
    -- This is a demonstration of the structure
end

-- ===========================================
-- Return Initialization Summary
-- ===========================================

redis.call('SELECT', 0)  -- Return to default database

-- Create initialization summary
local summary = {
    'Redis initialization completed',
    'Databases 0-9 configured with specific purposes',
    'Performance monitoring streams created',
    'Security and rate limiting configured',
    'Health check keys established',
    'Cache structures initialized',
    'Background job queues ready',
    'Configuration system active'
}

-- Store summary in Redis
redis.call('LPUSH', 'system:init_log', unpack(summary))
redis.call('EXPIRE', 'system:init_log', 86400)  -- Keep for 24 hours

-- Set global initialization flag
redis.call('SET', 'system:initialized', 'true')
redis.call('SET', 'system:init_timestamp', os.time())

return 'AI Answer Ninja Redis initialization completed successfully'