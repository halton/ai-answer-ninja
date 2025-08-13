/**
 * AI Answer Ninja - Database Query Analyzer
 * Advanced query performance analysis and optimization recommendations
 * Based on CLAUDE.md architecture specifications
 */

import { DatabaseConnectionManager } from '../../shared/database/src/core/DatabaseConnectionManager';
import { 
  QueryAnalysis, 
  IndexUsage, 
  OptimizationSuggestion,
  QueryPerformanceMetrics 
} from '../../shared/database/src/types';
import { createLogger } from '../../shared/database/src/utils/Logger';

export class DatabaseQueryAnalyzer {
  private dbManager: DatabaseConnectionManager;
  private logger = createLogger('DatabaseQueryAnalyzer');
  
  private queryCache = new Map<string, QueryAnalysis>();
  private analysisHistory: QueryPerformanceMetrics[] = [];
  private slowQueryThreshold = 1000; // 1 second

  constructor(dbManager: DatabaseConnectionManager) {
    this.dbManager = dbManager;
  }

  /**
   * Analyze query performance and provide optimization suggestions
   */
  public async analyzeQuery(
    sql: string, 
    params: any[] = [],
    includeExplain: boolean = true
  ): Promise<QueryAnalysis> {
    const queryHash = this.generateQueryHash(sql, params);
    
    // Check cache first
    const cached = this.queryCache.get(queryHash);
    if (cached && !includeExplain) {
      return cached;
    }

    try {
      const analysis: QueryAnalysis = {
        queryHash,
        queryType: this.extractQueryType(sql),
        estimatedCost: 0,
        indexUsage: [],
        suggestions: []
      };

      // Get query execution plan
      if (includeExplain) {
        const explainResult = await this.getExecutionPlan(sql, params);
        analysis.estimatedCost = explainResult.estimatedCost;
        analysis.actualCost = explainResult.actualCost;
        analysis.indexUsage = explainResult.indexUsage;
      }

      // Generate optimization suggestions
      analysis.suggestions = await this.generateOptimizationSuggestions(sql, analysis);

      // Cache the analysis
      this.queryCache.set(queryHash, analysis);

      return analysis;

    } catch (error) {
      this.logger.error('Query analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get detailed execution plan for query
   */
  private async getExecutionPlan(sql: string, params: any[]): Promise<{
    estimatedCost: number;
    actualCost?: number;
    indexUsage: IndexUsage[];
    executionTime?: number;
  }> {
    try {
      // Get estimated execution plan
      const explainResult = await this.dbManager.query(
        `EXPLAIN (FORMAT JSON, COSTS TRUE, BUFFERS TRUE) ${sql}`,
        params
      );

      const plan = explainResult.rows[0]['QUERY PLAN'][0];
      
      // Get actual execution plan for better analysis
      const explainAnalyzeResult = await this.dbManager.query(
        `EXPLAIN (ANALYZE TRUE, FORMAT JSON, COSTS TRUE, BUFFERS TRUE, TIMING TRUE) ${sql}`,
        params
      );

      const analyzePlan = explainAnalyzeResult.rows[0]['QUERY PLAN'][0];

      return {
        estimatedCost: plan['Total Cost'] || 0,
        actualCost: analyzePlan['Actual Total Time'] || 0,
        indexUsage: this.extractIndexUsage(analyzePlan),
        executionTime: analyzePlan['Execution Time'] || 0
      };

    } catch (error) {
      this.logger.error('Failed to get execution plan:', error);
      return {
        estimatedCost: 0,
        indexUsage: []
      };
    }
  }

  /**
   * Extract index usage information from execution plan
   */
  private extractIndexUsage(plan: any): IndexUsage[] {
    const indexUsage: IndexUsage[] = [];

    const extractFromNode = (node: any) => {
      if (node['Node Type']) {
        const nodeType = node['Node Type'];
        
        if (nodeType.includes('Index')) {
          const usage: IndexUsage = {
            indexName: node['Index Name'] || 'unknown',
            tableName: node['Relation Name'] || 'unknown',
            scanType: this.mapScanType(nodeType),
            rowsEstimated: node['Plan Rows'] || 0,
            rowsActual: node['Actual Rows'] || 0,
            efficiency: 0
          };

          // Calculate efficiency
          if (usage.rowsEstimated > 0) {
            usage.efficiency = Math.min(usage.rowsActual / usage.rowsEstimated, 1);
          }

          indexUsage.push(usage);
        }
      }

      // Recursively check child plans
      if (node.Plans && Array.isArray(node.Plans)) {
        node.Plans.forEach((childPlan: any) => {
          extractFromNode(childPlan);
        });
      }
    };

    extractFromNode(plan.Plan);
    return indexUsage;
  }

  private mapScanType(nodeType: string): 'seq_scan' | 'index_scan' | 'bitmap_scan' {
    if (nodeType.includes('Index Scan')) return 'index_scan';
    if (nodeType.includes('Bitmap')) return 'bitmap_scan';
    return 'seq_scan';
  }

  /**
   * Generate optimization suggestions based on query analysis
   */
  private async generateOptimizationSuggestions(
    sql: string, 
    analysis: QueryAnalysis
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // High cost query suggestions
    if (analysis.estimatedCost > 10000) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'high',
        description: 'Query has high estimated cost',
        estimatedImprovement: '30-50% faster execution',
        implementation: 'Consider breaking down complex joins or adding WHERE clause filters'
      });
    }

    // Sequential scan suggestions
    const sequentialScans = analysis.indexUsage.filter(usage => usage.scanType === 'seq_scan');
    if (sequentialScans.length > 0) {
      for (const scan of sequentialScans) {
        suggestions.push({
          type: 'index',
          priority: 'medium',
          description: `Sequential scan detected on table: ${scan.tableName}`,
          estimatedImprovement: '50-80% faster execution',
          implementation: `CREATE INDEX ON ${scan.tableName} (column_name); -- Add appropriate columns`
        });
      }
    }

    // Low efficiency index usage
    const inefficientIndexes = analysis.indexUsage.filter(usage => usage.efficiency < 0.1);
    if (inefficientIndexes.length > 0) {
      suggestions.push({
        type: 'index',
        priority: 'medium',
        description: 'Index usage efficiency is low',
        estimatedImprovement: '20-40% faster execution',
        implementation: 'Review and optimize existing indexes or query conditions'
      });
    }

    // Table-specific suggestions
    const tableSpecificSuggestions = await this.getTableSpecificSuggestions(sql);
    suggestions.push(...tableSpecificSuggestions);

    // Query pattern suggestions
    const patternSuggestions = this.getQueryPatternSuggestions(sql);
    suggestions.push(...patternSuggestions);

    return suggestions.sort((a, b) => {
      const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Get table-specific optimization suggestions
   */
  private async getTableSpecificSuggestions(sql: string): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    try {
      // Extract table names from query
      const tableNames = this.extractTableNames(sql);

      for (const tableName of tableNames) {
        // Check table statistics
        const statsResult = await this.dbManager.query(
          `SELECT 
            schemaname,
            tablename,
            n_tup_ins + n_tup_upd + n_tup_del as total_modifications,
            n_tup_ins,
            n_tup_upd,
            n_tup_del,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables 
          WHERE tablename = $1`,
          [tableName]
        );

        if (statsResult.rows.length > 0) {
          const stats = statsResult.rows[0];
          
          // Suggest ANALYZE if statistics are stale
          const lastAnalyze = stats.last_analyze || stats.last_autoanalyze;
          if (!lastAnalyze || (new Date().getTime() - new Date(lastAnalyze).getTime()) > 7 * 24 * 60 * 60 * 1000) {
            suggestions.push({
              type: 'statistics',
              priority: 'medium',
              description: `Table statistics are stale for ${tableName}`,
              estimatedImprovement: '10-30% better query planning',
              implementation: `ANALYZE ${tableName};`
            });
          }

          // Suggest partitioning for large tables with many modifications
          if (stats.total_modifications > 1000000) {
            suggestions.push({
              type: 'partition',
              priority: 'low',
              description: `Table ${tableName} has high modification rate`,
              estimatedImprovement: 'Better maintenance and query performance',
              implementation: `Consider partitioning table ${tableName} by date or other logical criteria`
            });
          }
        }

        // Check for missing indexes on foreign keys
        const foreignKeyResult = await this.dbManager.query(
          `SELECT 
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`,
          [tableName]
        );

        for (const fk of foreignKeyResult.rows) {
          // Check if index exists on foreign key column
          const indexExistsResult = await this.dbManager.query(
            `SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = $1 AND indexdef LIKE '%' || $2 || '%'`,
            [tableName, fk.column_name]
          );

          if (indexExistsResult.rows.length === 0) {
            suggestions.push({
              type: 'index',
              priority: 'medium',
              description: `Missing index on foreign key column ${fk.column_name}`,
              estimatedImprovement: '20-60% faster JOIN operations',
              implementation: `CREATE INDEX idx_${tableName}_${fk.column_name} ON ${tableName} (${fk.column_name});`
            });
          }
        }
      }

    } catch (error) {
      this.logger.error('Failed to get table-specific suggestions:', error);
    }

    return suggestions;
  }

  /**
   * Get query pattern-based suggestions
   */
  private getQueryPatternSuggestions(sql: string): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const normalizedSql = sql.toLowerCase().replace(/\s+/g, ' ').trim();

    // Check for common anti-patterns
    if (normalizedSql.includes('select *')) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'low',
        description: 'Using SELECT * may retrieve unnecessary columns',
        estimatedImprovement: '10-20% less data transfer',
        implementation: 'Specify only the columns you need instead of using SELECT *'
      });
    }

    if (normalizedSql.includes('like \'%') && !normalizedSql.includes('like \'%\'')) {
      suggestions.push({
        type: 'index',
        priority: 'medium',
        description: 'Leading wildcard LIKE patterns cannot use regular indexes',
        estimatedImprovement: '50-90% faster text search',
        implementation: 'Consider using full-text search (GIN index with tsvector) or pg_trgm extension'
      });
    }

    if (normalizedSql.match(/where.*or.*or/)) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'medium',
        description: 'Multiple OR conditions can be inefficient',
        estimatedImprovement: '20-50% faster execution',
        implementation: 'Consider using IN clause or UNION instead of multiple ORs'
      });
    }

    if (normalizedSql.includes('order by') && !normalizedSql.includes('limit')) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'low',
        description: 'ORDER BY without LIMIT sorts entire result set',
        estimatedImprovement: '30-70% faster for large result sets',
        implementation: 'Add LIMIT clause if you don\'t need all sorted results'
      });
    }

    // Check for subqueries that could be JOINs
    if (normalizedSql.includes('where') && normalizedSql.includes('in (select')) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'medium',
        description: 'Subquery in WHERE IN clause can often be optimized',
        estimatedImprovement: '20-40% faster execution',
        implementation: 'Consider rewriting as JOIN or using EXISTS instead of IN'
      });
    }

    return suggestions;
  }

  /**
   * Record query performance metrics
   */
  public recordQueryPerformance(metrics: QueryPerformanceMetrics): void {
    this.analysisHistory.push({
      ...metrics,
      timestamp: metrics.timestamp || new Date()
    });

    // Keep only recent history (last 1000 queries)
    if (this.analysisHistory.length > 1000) {
      this.analysisHistory = this.analysisHistory.slice(-1000);
    }

    // Check for slow queries
    if (metrics.executionTime > this.slowQueryThreshold) {
      this.logger.warn('Slow query detected:', {
        sql: metrics.sql.substring(0, 100),
        executionTime: metrics.executionTime,
        rowCount: metrics.rowCount
      });
    }
  }

  /**
   * Get query performance statistics
   */
  public getQueryStatistics(timeWindowMs: number = 3600000): {
    totalQueries: number;
    averageExecutionTime: number;
    slowQueries: number;
    cacheHitRate: number;
    topSlowQueries: QueryPerformanceMetrics[];
  } {
    const cutoffTime = new Date(Date.now() - timeWindowMs);
    const recentQueries = this.analysisHistory.filter(
      metric => (metric.timestamp || new Date()) >= cutoffTime
    );

    if (recentQueries.length === 0) {
      return {
        totalQueries: 0,
        averageExecutionTime: 0,
        slowQueries: 0,
        cacheHitRate: 0,
        topSlowQueries: []
      };
    }

    const totalQueries = recentQueries.length;
    const averageExecutionTime = recentQueries.reduce(
      (sum, metric) => sum + metric.executionTime, 0
    ) / totalQueries;

    const slowQueries = recentQueries.filter(
      metric => metric.executionTime > this.slowQueryThreshold
    ).length;

    const cacheHits = recentQueries.filter(metric => metric.cacheHit).length;
    const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;

    const topSlowQueries = recentQueries
      .filter(metric => metric.executionTime > this.slowQueryThreshold)
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    return {
      totalQueries,
      averageExecutionTime,
      slowQueries,
      cacheHitRate,
      topSlowQueries
    };
  }

  /**
   * Generate comprehensive query performance report
   */
  public async generateQueryReport(): Promise<{
    statistics: ReturnType<typeof this.getQueryStatistics>;
    recommendations: OptimizationSuggestion[];
    problematicPatterns: string[];
    indexRecommendations: string[];
  }> {
    const statistics = this.getQueryStatistics();
    
    // Analyze most common query patterns
    const queryPatterns = this.analyzeQueryPatterns();
    
    // Generate recommendations based on historical data
    const recommendations = await this.generateHistoricalRecommendations();
    
    // Identify problematic patterns
    const problematicPatterns = this.identifyProblematicPatterns();
    
    // Generate index recommendations
    const indexRecommendations = await this.generateIndexRecommendations();

    return {
      statistics,
      recommendations,
      problematicPatterns,
      indexRecommendations
    };
  }

  private analyzeQueryPatterns(): Record<string, number> {
    const patterns: Record<string, number> = {};
    
    this.analysisHistory.forEach(metric => {
      const queryType = this.extractQueryType(metric.sql);
      patterns[queryType] = (patterns[queryType] || 0) + 1;
    });

    return patterns;
  }

  private async generateHistoricalRecommendations(): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Analyze slow query patterns
    const slowQueries = this.analysisHistory.filter(
      metric => metric.executionTime > this.slowQueryThreshold
    );

    if (slowQueries.length > this.analysisHistory.length * 0.1) {
      suggestions.push({
        type: 'query_rewrite',
        priority: 'high',
        description: `${slowQueries.length} slow queries detected (${(slowQueries.length / this.analysisHistory.length * 100).toFixed(1)}% of total)`,
        estimatedImprovement: 'Significant performance improvement',
        implementation: 'Review and optimize the most frequent slow queries'
      });
    }

    return suggestions;
  }

  private identifyProblematicPatterns(): string[] {
    const patterns: string[] = [];
    
    const queryTypes = this.analyzeQueryPatterns();
    
    // Check for excessive SELECT queries
    if (queryTypes['SELECT'] > this.analysisHistory.length * 0.8) {
      patterns.push('High ratio of SELECT queries - consider caching strategies');
    }

    // Check for low cache hit rate
    const cacheHitRate = this.getQueryStatistics().cacheHitRate;
    if (cacheHitRate < 0.5) {
      patterns.push('Low cache hit rate - review caching strategy and TTL settings');
    }

    return patterns;
  }

  private async generateIndexRecommendations(): Promise<string[]> {
    const recommendations: string[] = [];

    try {
      // Find tables without primary keys
      const noPKResult = await this.dbManager.query(`
        SELECT t.table_name
        FROM information_schema.tables t
        LEFT JOIN information_schema.table_constraints tc 
          ON t.table_name = tc.table_name AND tc.constraint_type = 'PRIMARY KEY'
        WHERE t.table_schema = 'public' 
          AND t.table_type = 'BASE TABLE'
          AND tc.table_name IS NULL
      `);

      noPKResult.rows.forEach(row => {
        recommendations.push(`Add primary key to table: ${row.table_name}`);
      });

      // Find unused indexes
      const unusedIndexesResult = await this.dbManager.query(`
        SELECT schemaname, tablename, indexname, idx_scan
        FROM pg_stat_user_indexes
        WHERE idx_scan = 0 AND indexname NOT LIKE '%_pkey'
        ORDER BY pg_total_relation_size(indexrelid) DESC
      `);

      if (unusedIndexesResult.rows.length > 0) {
        recommendations.push(`Consider dropping ${unusedIndexesResult.rows.length} unused indexes to improve write performance`);
      }

    } catch (error) {
      this.logger.error('Failed to generate index recommendations:', error);
    }

    return recommendations;
  }

  // Utility methods
  private generateQueryHash(sql: string, params: any[]): string {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(sql + JSON.stringify(params))
      .digest('hex');
  }

  private extractQueryType(sql: string): string {
    const match = sql.trim().match(/^(\w+)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  private extractTableNames(sql: string): string[] {
    const tableRegex = /(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    const matches = sql.match(tableRegex);
    
    if (!matches) return [];
    
    return [...new Set(
      matches.map(match => match.split(/\s+/)[1].toLowerCase())
    )];
  }

  /**
   * Clear analysis cache and history
   */
  public clearCache(): void {
    this.queryCache.clear();
    this.analysisHistory = [];
    this.logger.info('Query analyzer cache cleared');
  }

  /**
   * Set slow query threshold
   */
  public setSlowQueryThreshold(thresholdMs: number): void {
    this.slowQueryThreshold = thresholdMs;
    this.logger.info(`Slow query threshold set to ${thresholdMs}ms`);
  }
}

export default DatabaseQueryAnalyzer;