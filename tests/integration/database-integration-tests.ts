/**
 * Database Integration and Transaction Tests
 * 
 * Comprehensive tests for database operations, transaction consistency,
 * data integrity, and cross-service database interactions.
 */

import { Pool, Client } from 'pg';
import Redis from 'ioredis';
import * as winston from 'winston';
import { performance } from 'perf_hooks';

export interface DatabaseTestConfig {
  postgresql: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  timeout: number;
  maxRetries: number;
  connectionPoolSize: number;
}

export interface DatabaseTestResult {
  testName: string;
  category: string;
  passed: boolean;
  duration: number;
  metrics?: {
    queryTime?: number;
    transactionTime?: number;
    rowsAffected?: number;
    cacheHitRate?: number;
    consistency?: boolean;
  };
  error?: string;
  details?: any;
}

export interface DatabaseTestSuite {
  suiteName: string;
  results: DatabaseTestResult[];
  passed: boolean;
  totalTests: number;
  passedTests: number;
  averageQueryTime: number;
  dataConsistencyRate: number;
}

export class DatabaseIntegrationTestRunner {
  private logger: winston.Logger;
  private config: DatabaseTestConfig;
  private pgPool: Pool;
  private redis: Redis;
  private testData: Map<string, any> = new Map();

  constructor(config: DatabaseTestConfig) {
    this.config = config;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    // Initialize database connections
    this.pgPool = new Pool({
      host: config.postgresql.host,
      port: config.postgresql.port,
      database: config.postgresql.database,
      user: config.postgresql.username,
      password: config.postgresql.password,
      ssl: config.postgresql.ssl,
      max: config.connectionPoolSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.timeout
    });

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      connectTimeout: config.timeout,
      lazyConnect: true
    });
  }

  /**
   * Execute database test with comprehensive monitoring
   */
  private async executeDatabaseTest(
    testName: string,
    category: string,
    testFn: () => Promise<{ metrics?: any; details?: any }>,
    timeout: number = this.config.timeout
  ): Promise<DatabaseTestResult> {
    const startTime = performance.now();
    
    try {
      this.logger.info(`🗄️ Starting database test: ${testName}`);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([testFn(), timeoutPromise]) as { metrics?: any; details?: any };
      const duration = performance.now() - startTime;

      this.logger.info(`✅ Database test passed: ${testName}`, {
        duration: Math.round(duration),
        metrics: result.metrics
      });

      return {
        testName,
        category,
        passed: true,
        duration: Math.round(duration),
        metrics: result.metrics,
        details: result.details
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error(`❌ Database test failed: ${testName}`, {
        duration: Math.round(duration),
        error: (error as Error).message
      });

      return {
        testName,
        category,
        passed: false,
        duration: Math.round(duration),
        error: (error as Error).message
      };
    }
  }

  /**
   * Basic Database Connectivity Tests
   */
  async testBasicConnectivity(): Promise<DatabaseTestSuite> {
    const results: DatabaseTestResult[] = [];
    const category = 'Basic Connectivity';

    // Test 1: PostgreSQL Connection
    results.push(await this.executeDatabaseTest(
      'PostgreSQL Connection',
      category,
      async () => {
        const queryStart = performance.now();
        const client = await this.pgPool.connect();
        const result = await client.query('SELECT NOW() as current_time, version()');
        client.release();
        const queryTime = performance.now() - queryStart;

        return {
          metrics: {
            queryTime: Math.round(queryTime),
            rowsAffected: result.rows.length
          },
          details: {
            connected: true,
            serverTime: result.rows[0]?.current_time,
            version: result.rows[0]?.version?.substring(0, 50) + '...'
          }
        };
      }
    ));

    // Test 2: Redis Connection
    results.push(await this.executeDatabaseTest(
      'Redis Connection',
      category,
      async () => {
        const queryStart = performance.now();
        await this.redis.connect();
        await this.redis.set('test_connection', 'ok', 'EX', 10);
        const result = await this.redis.get('test_connection');
        const queryTime = performance.now() - queryStart;

        return {
          metrics: {
            queryTime: Math.round(queryTime)
          },
          details: {
            connected: true,
            testValue: result,
            redisInfo: await this.redis.info('server')
          }
        };
      }
    ));

    // Test 3: Connection Pool Stress Test
    results.push(await this.executeDatabaseTest(
      'Connection Pool Stress Test',
      category,
      async () => {
        const concurrentConnections = this.config.connectionPoolSize;
        const queries: Promise<any>[] = [];

        for (let i = 0; i < concurrentConnections; i++) {
          queries.push((async () => {
            const client = await this.pgPool.connect();
            try {
              const result = await client.query('SELECT $1 as connection_id, pg_sleep(0.1)', [i]);
              return { id: i, success: true, rows: result.rows.length };
            } finally {
              client.release();
            }
          })());
        }

        const poolStart = performance.now();
        const results = await Promise.allSettled(queries);
        const poolTime = performance.now() - poolStart;
        
        const successful = results.filter(r => r.status === 'fulfilled').length;

        return {
          metrics: {
            queryTime: Math.round(poolTime),
            rowsAffected: successful
          },
          details: {
            concurrentConnections,
            successfulConnections: successful,
            failedConnections: concurrentConnections - successful,
            poolEfficiency: successful / concurrentConnections
          }
        };
      },
      this.config.timeout * 2
    ));

    return this.calculateSuiteMetrics('Basic Connectivity Tests', results);
  }

  /**
   * CRUD Operations and Data Integrity Tests
   */
  async testCRUDOperations(): Promise<DatabaseTestSuite> {
    const results: DatabaseTestResult[] = [];
    const category = 'CRUD Operations';

    // Test 1: User Management CRUD
    results.push(await this.executeDatabaseTest(
      'User Management CRUD Operations',
      category,
      async () => {
        const client = await this.pgPool.connect();
        
        try {
          await client.query('BEGIN');

          // CREATE
          const createStart = performance.now();
          const testUser = {
            phone_number: `+1555${Date.now().toString().slice(-7)}`,
            name: 'DB Test User',
            personality: 'professional',
            preferences: JSON.stringify({ auto_hang_up: true })
          };

          const createResult = await client.query(`
            INSERT INTO users (phone_number, name, personality, preferences)
            VALUES ($1, $2, $3, $4)
            RETURNING id, created_at
          `, [testUser.phone_number, testUser.name, testUser.personality, testUser.preferences]);

          const userId = createResult.rows[0].id;
          this.testData.set('testUserId', userId);
          const createTime = performance.now() - createStart;

          // READ
          const readStart = performance.now();
          const readResult = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
          const readTime = performance.now() - readStart;

          // UPDATE
          const updateStart = performance.now();
          const updatedName = 'Updated DB Test User';
          const updateResult = await client.query(`
            UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING name, updated_at
          `, [updatedName, userId]);
          const updateTime = performance.now() - updateStart;

          // Verify UPDATE
          const verifyResult = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
          
          await client.query('COMMIT');

          const totalTime = createTime + readTime + updateTime;

          return {
            metrics: {
              queryTime: Math.round(totalTime),
              transactionTime: Math.round(totalTime),
              rowsAffected: 1,
              consistency: verifyResult.rows[0].name === updatedName
            },
            details: {
              userCreated: !!createResult.rows[0].id,
              userRead: readResult.rows.length === 1,
              userUpdated: updateResult.rows.length === 1,
              nameVerified: verifyResult.rows[0].name === updatedName,
              operations: {
                create: Math.round(createTime),
                read: Math.round(readTime),
                update: Math.round(updateTime)
              }
            }
          };

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    ));

    // Test 2: Call Records CRUD with Partitioning
    results.push(await this.executeDatabaseTest(
      'Call Records CRUD with Partitioning',
      category,
      async () => {
        const client = await this.pgPool.connect();
        const userId = this.testData.get('testUserId');
        
        if (!userId) throw new Error('Test user not created');

        try {
          await client.query('BEGIN');

          // CREATE call record
          const createStart = performance.now();
          const callRecord = {
            user_id: userId,
            caller_phone: '+1555987654',
            call_type: 'incoming_spam',
            call_status: 'ai_handled',
            start_time: new Date(),
            duration_seconds: 45,
            azure_call_id: `test_call_${Date.now()}`
          };

          const createResult = await client.query(`
            INSERT INTO call_records (user_id, caller_phone, call_type, call_status, start_time, duration_seconds, azure_call_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, year_month
          `, [callRecord.user_id, callRecord.caller_phone, callRecord.call_type, 
              callRecord.call_status, callRecord.start_time, callRecord.duration_seconds, callRecord.azure_call_id]);

          const callId = createResult.rows[0].id;
          const createTime = performance.now() - createStart;

          // READ with partition-aware query
          const readStart = performance.now();
          const readResult = await client.query(`
            SELECT * FROM call_records 
            WHERE user_id = $1 AND id = $2
            AND start_time >= $3::date
          `, [userId, callId, new Date().toISOString().split('T')[0]]);
          const readTime = performance.now() - readStart;

          // CREATE conversation records
          const conversationStart = performance.now();
          const conversations = [
            { speaker: 'caller', message_text: '你好，我是XX银行的', intent_category: 'banking_sales' },
            { speaker: 'ai', message_text: '我现在不方便，谢谢', intent_category: 'polite_decline' }
          ];

          const conversationPromises = conversations.map(conv =>
            client.query(`
              INSERT INTO conversations (call_record_id, speaker, message_text, timestamp, intent_category)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `, [callId, conv.speaker, conv.message_text, new Date(), conv.intent_category])
          );

          const conversationResults = await Promise.all(conversationPromises);
          const conversationTime = performance.now() - conversationStart;

          await client.query('COMMIT');

          const totalTime = createTime + readTime + conversationTime;

          return {
            metrics: {
              queryTime: Math.round(totalTime),
              transactionTime: Math.round(totalTime),
              rowsAffected: 1 + conversationResults.length,
              consistency: true
            },
            details: {
              callRecordCreated: !!createResult.rows[0].id,
              partitionUsed: createResult.rows[0].year_month,
              callRecordRead: readResult.rows.length === 1,
              conversationsCreated: conversationResults.length,
              operations: {
                create: Math.round(createTime),
                read: Math.round(readTime),
                conversations: Math.round(conversationTime)
              }
            }
          };

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    ));

    // Test 3: Whitelist Management with Redis Cache
    results.push(await this.executeDatabaseTest(
      'Whitelist Management with Cache',
      category,
      async () => {
        const client = await this.pgPool.connect();
        const userId = this.testData.get('testUserId');
        
        if (!userId) throw new Error('Test user not created');

        try {
          await client.query('BEGIN');

          const whitelistEntry = {
            user_id: userId,
            contact_phone: '+1555123456',
            contact_name: 'DB Test Contact',
            whitelist_type: 'manual',
            confidence_score: 1.0
          };

          // CREATE whitelist entry
          const createStart = performance.now();
          const createResult = await client.query(`
            INSERT INTO smart_whitelists (user_id, contact_phone, contact_name, whitelist_type, confidence_score)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, [whitelistEntry.user_id, whitelistEntry.contact_phone, whitelistEntry.contact_name, 
              whitelistEntry.whitelist_type, whitelistEntry.confidence_score]);

          const whitelistId = createResult.rows[0].id;
          const createTime = performance.now() - createStart;

          // Cache the result in Redis
          const cacheStart = performance.now();
          const cacheKey = `whitelist:${userId}:${whitelistEntry.contact_phone}`;
          await this.redis.setex(cacheKey, 300, JSON.stringify({
            id: whitelistId,
            is_whitelisted: true,
            contact_name: whitelistEntry.contact_name,
            confidence_score: whitelistEntry.confidence_score
          }));
          const cacheTime = performance.now() - cacheStart;

          // Test cache retrieval
          const cacheReadStart = performance.now();
          const cachedResult = await this.redis.get(cacheKey);
          const cacheReadTime = performance.now() - cacheReadStart;

          // Verify database consistency
          const verifyStart = performance.now();
          const verifyResult = await client.query(`
            SELECT * FROM smart_whitelists 
            WHERE user_id = $1 AND contact_phone = $2 AND is_active = true
          `, [userId, whitelistEntry.contact_phone]);
          const verifyTime = performance.now() - verifyStart;

          await client.query('COMMIT');

          const totalTime = createTime + cacheTime + cacheReadTime + verifyTime;
          const cacheData = JSON.parse(cachedResult || '{}');
          const dbData = verifyResult.rows[0];

          return {
            metrics: {
              queryTime: Math.round(totalTime),
              cacheHitRate: cachedResult ? 1.0 : 0.0,
              consistency: cacheData.id === dbData.id
            },
            details: {
              whitelistCreated: !!createResult.rows[0].id,
              cachedSuccessfully: !!cachedResult,
              dataConsistent: cacheData.contact_name === dbData.contact_name,
              operations: {
                create: Math.round(createTime),
                cache: Math.round(cacheTime),
                cacheRead: Math.round(cacheReadTime),
                verify: Math.round(verifyTime)
              }
            }
          };

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    ));

    return this.calculateSuiteMetrics('CRUD Operations Tests', results);
  }

  /**
   * Complex Transaction and Consistency Tests
   */
  async testTransactionConsistency(): Promise<DatabaseTestSuite> {
    const results: DatabaseTestResult[] = [];
    const category = 'Transaction Consistency';

    // Test 1: Multi-table Transaction Consistency
    results.push(await this.executeDatabaseTest(
      'Multi-table Transaction Consistency',
      category,
      async () => {
        const client = await this.pgPool.connect();
        
        try {
          await client.query('BEGIN');

          const transactionStart = performance.now();

          // Create user
          const userResult = await client.query(`
            INSERT INTO users (phone_number, name, personality)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [`+1555${Date.now().toString().slice(-7)}`, 'Transaction Test User', 'direct']);

          const userId = userResult.rows[0].id;

          // Create call record
          const callResult = await client.query(`
            INSERT INTO call_records (user_id, caller_phone, call_type, call_status, start_time)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, [userId, '+1555999888', 'incoming_spam', 'ai_handled', new Date()]);

          const callId = callResult.rows[0].id;

          // Create multiple conversation entries
          const conversations = [
            { speaker: 'caller', message_text: '推销保险产品', intent_category: 'insurance_sales' },
            { speaker: 'ai', message_text: '我不需要保险', intent_category: 'decline' },
            { speaker: 'caller', message_text: '了解一下吧', intent_category: 'persistence' },
            { speaker: 'ai', message_text: '请不要打扰我', intent_category: 'firm_decline' }
          ];

          for (const conv of conversations) {
            await client.query(`
              INSERT INTO conversations (call_record_id, speaker, message_text, timestamp, intent_category)
              VALUES ($1, $2, $3, $4, $5)
            `, [callId, conv.speaker, conv.message_text, new Date(), conv.intent_category]);
          }

          // Update call record with final status
          await client.query(`
            UPDATE call_records 
            SET call_status = $1, end_time = $2, duration_seconds = 65
            WHERE id = $3
          `, ['caller_hung_up', new Date(), callId]);

          // Create analytics entry
          await client.query(`
            INSERT INTO user_spam_interactions (user_id, spam_profile_id, interaction_count, last_interaction, effectiveness_score)
            VALUES ($1, $2, $3, $4, $5)
          `, [userId, 'default-spam-profile-id', 1, new Date(), 0.85]);

          const transactionTime = performance.now() - transactionStart;

          await client.query('COMMIT');

          // Verify all data is consistent
          const verifyStart = performance.now();
          const verifyUser = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
          const verifyCall = await client.query('SELECT * FROM call_records WHERE id = $1', [callId]);
          const verifyConversations = await client.query('SELECT * FROM conversations WHERE call_record_id = $1', [callId]);
          const verifyTime = performance.now() - verifyStart;

          return {
            metrics: {
              transactionTime: Math.round(transactionTime),
              queryTime: Math.round(transactionTime + verifyTime),
              rowsAffected: 1 + 1 + conversations.length + 1,
              consistency: verifyUser.rows.length === 1 && 
                          verifyCall.rows.length === 1 && 
                          verifyConversations.rows.length === conversations.length
            },
            details: {
              userCreated: verifyUser.rows.length === 1,
              callCreated: verifyCall.rows.length === 1,
              conversationsCreated: verifyConversations.rows.length,
              expectedConversations: conversations.length,
              callDuration: verifyCall.rows[0]?.duration_seconds,
              allDataConsistent: true
            }
          };

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    ));

    // Test 2: Concurrent Transaction Isolation
    results.push(await this.executeDatabaseTest(
      'Concurrent Transaction Isolation',
      category,
      async () => {
        const concurrentTransactions = 3;
        const transactionPromises: Promise<any>[] = [];

        for (let i = 0; i < concurrentTransactions; i++) {
          transactionPromises.push((async () => {
            const client = await this.pgPool.connect();
            
            try {
              await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

              const userResult = await client.query(`
                INSERT INTO users (phone_number, name, personality)
                VALUES ($1, $2, $3)
                RETURNING id
              `, [`+1555${(Date.now() + i).toString().slice(-7)}`, `Concurrent User ${i}`, 'polite']);

              // Simulate some processing time
              await new Promise(resolve => setTimeout(resolve, 100));

              await client.query(`
                INSERT INTO smart_whitelists (user_id, contact_phone, contact_name, whitelist_type)
                VALUES ($1, $2, $3, $4)
              `, [userResult.rows[0].id, `+1555${Date.now()}${i}`, `Contact ${i}`, 'auto']);

              await client.query('COMMIT');
              return { transaction: i, success: true, user_id: userResult.rows[0].id };

            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          })());
        }

        const concurrentStart = performance.now();
        const results = await Promise.allSettled(transactionPromises);
        const concurrentTime = performance.now() - concurrentStart;

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        return {
          metrics: {
            transactionTime: Math.round(concurrentTime),
            rowsAffected: successful * 2, // Each successful transaction creates user + whitelist
            consistency: successful > 0 && failed === 0
          },
          details: {
            concurrentTransactions,
            successfulTransactions: successful,
            failedTransactions: failed,
            isolationMaintained: failed === 0,
            averageTransactionTime: Math.round(concurrentTime / concurrentTransactions)
          }
        };
      },
      this.config.timeout * 2
    ));

    // Test 3: Distributed Transaction with Redis
    results.push(await this.executeDatabaseTest(
      'Distributed Transaction with Redis',
      category,
      async () => {
        const client = await this.pgPool.connect();
        const userId = this.testData.get('testUserId');
        
        if (!userId) throw new Error('Test user not created');

        try {
          // Start database transaction
          await client.query('BEGIN');

          const distributedStart = performance.now();

          // Database operations
          const dbResult = await client.query(`
            INSERT INTO call_records (user_id, caller_phone, call_type, call_status, start_time)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, [userId, '+1555777999', 'incoming_spam', 'processing', new Date()]);

          const callId = dbResult.rows[0].id;

          // Redis operations (simulate distributed transaction)
          const multi = this.redis.multi();
          multi.hset(`call:${callId}`, {
            status: 'processing',
            start_time: Date.now(),
            user_id: userId,
            caller_phone: '+1555777999'
          });
          multi.expire(`call:${callId}`, 3600);
          multi.zadd('active_calls', Date.now(), callId);
          
          const redisResults = await multi.exec();

          // If Redis operations successful, complete database transaction
          if (redisResults && redisResults.every(result => result[0] === null)) {
            // Update database with final status
            await client.query(`
              UPDATE call_records 
              SET call_status = $1, processing_metadata = $2
              WHERE id = $3
            `, ['redis_synced', JSON.stringify({ redis_keys_created: 3 }), callId]);

            await client.query('COMMIT');

            const distributedTime = performance.now() - distributedStart;

            // Verify consistency between PostgreSQL and Redis
            const dbVerify = await client.query('SELECT * FROM call_records WHERE id = $1', [callId]);
            const redisVerify = await this.redis.hgetall(`call:${callId}`);

            const consistent = dbVerify.rows[0] && 
                             redisVerify.user_id === userId && 
                             redisVerify.status === 'processing';

            return {
              metrics: {
                transactionTime: Math.round(distributedTime),
                consistency: consistent,
                rowsAffected: 1
              },
              details: {
                databaseCommitted: dbVerify.rows[0]?.call_status === 'redis_synced',
                redisOperationsSuccessful: redisResults.length === 3,
                dataConsistent: consistent,
                redisKeys: Object.keys(redisVerify).length
              }
            };

          } else {
            // Redis operations failed, rollback database
            await client.query('ROLLBACK');
            throw new Error('Redis operations failed, transaction rolled back');
          }

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    ));

    return this.calculateSuiteMetrics('Transaction Consistency Tests', results);
  }

  /**
   * Performance and Scalability Tests
   */
  async testPerformanceAndScalability(): Promise<DatabaseTestSuite> {
    const results: DatabaseTestResult[] = [];
    const category = 'Performance & Scalability';

    // Test 1: Bulk Insert Performance
    results.push(await this.executeDatabaseTest(
      'Bulk Insert Performance',
      category,
      async () => {
        const client = await this.pgPool.connect();
        const recordCount = 1000;
        
        try {
          const bulkStart = performance.now();

          // Generate bulk test data
          const users = [];
          for (let i = 0; i < recordCount; i++) {
            users.push([
              `+1555${Date.now().toString().slice(-3)}${i.toString().padStart(4, '0')}`,
              `Bulk Test User ${i}`,
              i % 3 === 0 ? 'polite' : i % 3 === 1 ? 'direct' : 'professional'
            ]);
          }

          // Bulk insert using COPY or batch INSERT
          const insertQuery = `
            INSERT INTO users (phone_number, name, personality) 
            VALUES ${users.map((_, i) => `($${i*3+1}, $${i*3+2}, $${i*3+3})`).join(', ')}
          `;
          const flattenedValues = users.flat();

          const result = await client.query(insertQuery, flattenedValues);
          const bulkTime = performance.now() - bulkStart;

          // Clean up test data
          await client.query(`
            DELETE FROM users 
            WHERE name LIKE 'Bulk Test User %'
          `);

          return {
            metrics: {
              queryTime: Math.round(bulkTime),
              rowsAffected: result.rowCount || 0
            },
            details: {
              recordsInserted: result.rowCount || 0,
              expectedRecords: recordCount,
              insertRate: Math.round(recordCount / (bulkTime / 1000)), // records per second
              operationType: 'bulk_insert'
            }
          };

        } finally {
          client.release();
        }
      },
      this.config.timeout * 3
    ));

    // Test 2: Query Performance on Large Dataset
    results.push(await this.executeDatabaseTest(
      'Query Performance on Partitioned Data',
      category,
      async () => {
        const client = await this.pgPool.connect();
        
        try {
          // Test partition pruning with date range query
          const queryStart = performance.now();
          
          const result = await client.query(`
            SELECT 
              COUNT(*) as total_calls,
              call_type,
              AVG(duration_seconds) as avg_duration
            FROM call_records 
            WHERE start_time >= $1 
              AND start_time <= $2
              AND call_status = 'ai_handled'
            GROUP BY call_type
            ORDER BY total_calls DESC
          `, [
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            new Date()
          ]);

          const queryTime = performance.now() - queryStart;

          // Test index performance
          const indexStart = performance.now();
          const indexResult = await client.query(`
            SELECT COUNT(*) FROM call_records 
            WHERE user_id = $1 AND start_time >= $2
          `, ['test-user-id', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)]);
          const indexTime = performance.now() - indexStart;

          return {
            metrics: {
              queryTime: Math.round(queryTime + indexTime),
              rowsAffected: result.rows.length
            },
            details: {
              aggregateQueryTime: Math.round(queryTime),
              indexQueryTime: Math.round(indexTime),
              aggregateResults: result.rows.length,
              partitionPruning: queryTime < 500, // Expect fast query with partition pruning
              indexUsed: indexTime < 100 // Expect fast query with index
            }
          };

        } finally {
          client.release();
        }
      }
    ));

    // Test 3: Redis Performance and Memory Usage
    results.push(await this.executeDatabaseTest(
      'Redis Performance and Memory Usage',
      category,
      async () => {
        const keyCount = 10000;
        const batchSize = 100;

        const performanceStart = performance.now();

        // Batch SET operations
        const batches = Math.ceil(keyCount / batchSize);
        for (let i = 0; i < batches; i++) {
          const multi = this.redis.multi();
          
          for (let j = 0; j < batchSize && (i * batchSize + j) < keyCount; j++) {
            const keyIndex = i * batchSize + j;
            multi.setex(`perf_test:${keyIndex}`, 300, JSON.stringify({
              id: keyIndex,
              data: `test_data_${keyIndex}`,
              timestamp: Date.now()
            }));
          }
          
          await multi.exec();
        }

        const setTime = performance.now() - performanceStart;

        // Test GET performance
        const getStart = performance.now();
        const getPromises = [];
        for (let i = 0; i < 1000; i++) {
          getPromises.push(this.redis.get(`perf_test:${i}`));
        }
        await Promise.all(getPromises);
        const getTime = performance.now() - getStart;

        // Clean up test keys
        const keys = await this.redis.keys('perf_test:*');
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }

        const totalTime = setTime + getTime;

        return {
          metrics: {
            queryTime: Math.round(totalTime),
            cacheHitRate: 1.0
          },
          details: {
            keysSet: keyCount,
            keysRetrieved: 1000,
            setOperationTime: Math.round(setTime),
            getOperationTime: Math.round(getTime),
            setRate: Math.round(keyCount / (setTime / 1000)),
            getRate: Math.round(1000 / (getTime / 1000))
          }
        };
      },
      this.config.timeout * 2
    ));

    return this.calculateSuiteMetrics('Performance & Scalability Tests', results);
  }

  /**
   * Calculate suite metrics from test results
   */
  private calculateSuiteMetrics(suiteName: string, results: DatabaseTestResult[]): DatabaseTestSuite {
    const passedTests = results.filter(r => r.passed).length;
    const totalQueryTime = results.reduce((sum, r) => sum + (r.metrics?.queryTime || r.duration), 0);
    const consistencyChecks = results.filter(r => r.metrics?.consistency !== undefined);
    const consistentResults = consistencyChecks.filter(r => r.metrics?.consistency).length;

    return {
      suiteName,
      results,
      passed: passedTests === results.length,
      totalTests: results.length,
      passedTests,
      averageQueryTime: Math.round(totalQueryTime / results.length) || 0,
      dataConsistencyRate: consistencyChecks.length > 0 
        ? Math.round((consistentResults / consistencyChecks.length) * 100) / 100
        : 1.0
    };
  }

  /**
   * Run all database integration tests
   */
  async runAllTests(): Promise<{
    overall: {
      passed: boolean;
      totalSuites: number;
      passedSuites: number;
      totalTests: number;
      passedTests: number;
      averageQueryTime: number;
      dataConsistencyRate: number;
    };
    suites: DatabaseTestSuite[];
  }> {
    this.logger.info('🗄️ Starting Database Integration Tests');

    const suites: DatabaseTestSuite[] = [];

    try {
      // Run test suites
      suites.push(await this.testBasicConnectivity());
      suites.push(await this.testCRUDOperations());
      suites.push(await this.testTransactionConsistency());
      suites.push(await this.testPerformanceAndScalability());

      const passedSuites = suites.filter(s => s.passed).length;
      const totalTests = suites.reduce((sum, s) => sum + s.totalTests, 0);
      const passedTests = suites.reduce((sum, s) => sum + s.passedTests, 0);
      const totalQueryTime = suites.reduce((sum, s) => sum + (s.averageQueryTime * s.totalTests), 0);
      const consistencyRates = suites.map(s => s.dataConsistencyRate);
      const avgConsistencyRate = consistencyRates.reduce((a, b) => a + b) / consistencyRates.length;

      const overall = {
        passed: passedSuites === suites.length,
        totalSuites: suites.length,
        passedSuites,
        totalTests,
        passedTests,
        averageQueryTime: Math.round(totalQueryTime / totalTests) || 0,
        dataConsistencyRate: Math.round(avgConsistencyRate * 100) / 100
      };

      this.logger.info('📊 Database Integration Test Summary', {
        overall,
        suiteResults: suites.map(s => ({
          name: s.suiteName,
          passed: s.passed,
          tests: `${s.passedTests}/${s.totalTests}`,
          avgQueryTime: `${s.averageQueryTime}ms`,
          consistency: `${Math.round(s.dataConsistencyRate * 100)}%`
        }))
      });

      return { overall, suites };

    } catch (error) {
      this.logger.error('💥 Database Integration test execution failed', { error: (error as Error).message });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Cleanup test data and connections
   */
  async cleanup(): Promise<void> {
    this.logger.info('🧹 Cleaning up database test data...');
    
    try {
      // Clean up test users and related data
      const testUserId = this.testData.get('testUserId');
      if (testUserId) {
        const client = await this.pgPool.connect();
        try {
          await client.query('BEGIN');
          
          // Delete in order to respect foreign key constraints
          await client.query('DELETE FROM conversations WHERE call_record_id IN (SELECT id FROM call_records WHERE user_id = $1)', [testUserId]);
          await client.query('DELETE FROM call_records WHERE user_id = $1', [testUserId]);
          await client.query('DELETE FROM smart_whitelists WHERE user_id = $1', [testUserId]);
          await client.query('DELETE FROM user_spam_interactions WHERE user_id = $1', [testUserId]);
          await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
          
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          this.logger.warn('Failed to clean up database test data', { error: (error as Error).message });
        } finally {
          client.release();
        }
      }

      // Clean up Redis test keys
      const testKeys = await this.redis.keys('test_*');
      const whitelistKeys = await this.redis.keys('whitelist:*');
      const callKeys = await this.redis.keys('call:*');
      const perfKeys = await this.redis.keys('perf_test:*');
      
      const allKeys = [...testKeys, ...whitelistKeys, ...callKeys, ...perfKeys];
      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
      }

      this.testData.clear();
      this.logger.info('✅ Database test cleanup completed');
      
    } catch (error) {
      this.logger.error('❌ Database test cleanup failed', { error: (error as Error).message });
    }
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    await this.pgPool.end();
    await this.redis.quit();
  }
}

export default DatabaseIntegrationTestRunner;