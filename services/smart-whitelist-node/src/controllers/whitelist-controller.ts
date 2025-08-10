import { Response, NextFunction } from 'express';
import { whitelistService } from '@/services/whitelist-service';
import { rulesEngine } from '@/ml/rules-engine';
import { logger } from '@/utils/logger';
import { 
  ApiResponse, 
  PaginatedResponse, 
  BatchOperationResult,
  SmartWhitelist,
  EvaluationResult,
  UserRules 
} from '@/types';
import { AuthenticatedRequest } from '@/middleware/auth';

export class WhitelistController {

  /**
   * GET /api/v1/whitelist/:userId
   * Get user's whitelist entries with pagination and filtering
   */
  async getUserWhitelist(
    req: AuthenticatedRequest,
    res: Response<PaginatedResponse<SmartWhitelist>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const { page, limit, active, type, search } = req.query as any;

      const result = await whitelistService.getUserWhitelist(userId, {
        page,
        limit,
        active,
        type,
        search,
      });

      const response: PaginatedResponse<SmartWhitelist> = {
        success: true,
        data: result.entries,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          pages: result.pages,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist
   * Create a new whitelist entry
   */
  async createWhitelistEntry(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<SmartWhitelist>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const entry = await whitelistService.createWhitelistEntry(req.body);

      const response: ApiResponse<SmartWhitelist> = {
        success: true,
        data: entry,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/whitelist/:id
   * Update an existing whitelist entry
   */
  async updateWhitelistEntry(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<SmartWhitelist>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;

      const entry = await whitelistService.updateWhitelistEntry(id, userId, req.body);

      const response: ApiResponse<SmartWhitelist> = {
        success: true,
        data: entry,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/whitelist/:id
   * Delete a whitelist entry
   */
  async deleteWhitelistEntry(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<{ deleted: boolean }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;

      const deleted = await whitelistService.deleteWhitelistEntry(id, userId);

      const response: ApiResponse<{ deleted: boolean }> = {
        success: true,
        data: { deleted },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist/smart-add
   * Intelligently add a phone number with ML assistance
   */
  async smartAdd(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<SmartWhitelist>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const entry = await whitelistService.smartAdd(req.body);

      const response: ApiResponse<SmartWhitelist> = {
        success: true,
        data: entry,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist/evaluate
   * Evaluate a phone number using ML and rules
   */
  async evaluatePhone(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<EvaluationResult>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const start = Date.now();
      
      // Get user rules if userId is provided
      let userRules;
      if (req.body.userId) {
        userRules = await whitelistService.getUserRules(req.body.userId);
      }

      // Use rules engine for evaluation
      const result = await rulesEngine.evaluate(req.body, userRules);
      
      const response: ApiResponse<EvaluationResult> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
          processingTime: Date.now() - start,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist/learning
   * Record learning feedback
   */
  async recordLearning(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<{ recorded: boolean }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      await whitelistService.recordLearning(req.body);

      const response: ApiResponse<{ recorded: boolean }> = {
        success: true,
        data: { recorded: true },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/whitelist/rules/:userId
   * Get user's whitelist rules
   */
  async getUserRules(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<UserRules['rules']>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const rules = await whitelistService.getUserRules(userId);

      const response: ApiResponse<UserRules['rules']> = {
        success: true,
        data: rules,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/whitelist/rules/:userId
   * Update user's whitelist rules
   */
  async updateUserRules(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<{ updated: boolean }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId } = req.params;
      await whitelistService.updateUserRules(userId, req.body.rules);

      const response: ApiResponse<{ updated: boolean }> = {
        success: true,
        data: { updated: true },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist/batch
   * Create multiple whitelist entries
   */
  async batchCreate(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<BatchOperationResult & { entries: SmartWhitelist[] }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { entries } = req.body;
      const results: SmartWhitelist[] = [];
      const errors: Array<{ index: number; error: string }> = [];
      let successful = 0;

      for (let i = 0; i < entries.length; i++) {
        try {
          const entry = await whitelistService.createWhitelistEntry(entries[i]);
          results.push(entry);
          successful++;
        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const response: ApiResponse<BatchOperationResult & { entries: SmartWhitelist[] }> = {
        success: true,
        data: {
          successful,
          failed: errors.length,
          errors,
          entries: results,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(207).json(response); // 207 Multi-Status
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/whitelist/batch
   * Update multiple whitelist entries
   */
  async batchUpdate(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<BatchOperationResult & { entries: SmartWhitelist[] }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { updates } = req.body;
      const userId = req.user!.userId;
      const results: SmartWhitelist[] = [];
      const errors: Array<{ index: number; error: string }> = [];
      let successful = 0;

      for (let i = 0; i < updates.length; i++) {
        try {
          const { id, ...updateData } = updates[i];
          const entry = await whitelistService.updateWhitelistEntry(id, userId, updateData);
          results.push(entry);
          successful++;
        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const response: ApiResponse<BatchOperationResult & { entries: SmartWhitelist[] }> = {
        success: true,
        data: {
          successful,
          failed: errors.length,
          errors,
          entries: results,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(207).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/whitelist/batch
   * Delete multiple whitelist entries
   */
  async batchDelete(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<BatchOperationResult>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { ids, userId } = req.body;
      const errors: Array<{ index: number; error: string }> = [];
      let successful = 0;

      for (let i = 0; i < ids.length; i++) {
        try {
          await whitelistService.deleteWhitelistEntry(ids[i], userId);
          successful++;
        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const response: ApiResponse<BatchOperationResult> = {
        success: true,
        data: {
          successful,
          failed: errors.length,
          errors,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/whitelist/import
   * Import whitelist entries from external source
   */
  async importWhitelist(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<BatchOperationResult & { imported: number }>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId, entries, overwrite } = req.body;
      const errors: Array<{ index: number; error: string }> = [];
      let successful = 0;
      let imported = 0;

      for (let i = 0; i < entries.length; i++) {
        try {
          const entryData = {
            userId,
            ...entries[i],
          };

          // Check if entry exists if not overwriting
          if (!overwrite) {
            // This would require a method to check existence
            // For now, just try to create and handle conflicts
          }

          await whitelistService.createWhitelistEntry(entryData);
          successful++;
          imported++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // If it's a conflict error and not overwriting, skip
          if (errorMessage.includes('already in whitelist') && !overwrite) {
            continue;
          }

          errors.push({
            index: i,
            error: errorMessage,
          });
        }
      }

      const response: ApiResponse<BatchOperationResult & { imported: number }> = {
        success: true,
        data: {
          successful,
          failed: errors.length,
          errors,
          imported,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/whitelist/export/:userId
   * Export user's whitelist entries
   */
  async exportWhitelist(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const { format, includeExpired } = req.query as any;

      // Get all entries
      const result = await whitelistService.getUserWhitelist(userId, {
        page: 1,
        limit: 10000, // Get all entries
        active: includeExpired ? undefined : true,
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `whitelist-${userId}-${timestamp}`;

      if (format === 'csv') {
        // Convert to CSV
        const csvData = this.convertToCSV(result.entries);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.status(200).send(csvData);
      } else {
        // JSON format (default)
        const exportData = {
          userId,
          exportDate: new Date().toISOString(),
          totalEntries: result.total,
          entries: result.entries,
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.status(200).json(exportData);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/whitelist/stats/:userId
   * Get user whitelist statistics
   */
  async getUserStats(
    req: AuthenticatedRequest,
    res: Response<ApiResponse<any>>,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userId } = req.params;

      // Get various statistics
      const [totalResult, activeResult, typeStats] = await Promise.all([
        whitelistService.getUserWhitelist(userId, { page: 1, limit: 1 }),
        whitelistService.getUserWhitelist(userId, { page: 1, limit: 1, active: true }),
        this.getWhitelistTypeStats(userId),
      ]);

      const stats = {
        total: totalResult.total,
        active: activeResult.total,
        inactive: totalResult.total - activeResult.total,
        byType: typeStats,
        lastUpdated: new Date().toISOString(),
      };

      const response: ApiResponse<any> = {
        success: true,
        data: stats,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  // Helper methods

  private convertToCSV(entries: SmartWhitelist[]): string {
    const headers = [
      'ID',
      'Contact Phone',
      'Contact Name',
      'Whitelist Type',
      'Confidence Score',
      'Is Active',
      'Hit Count',
      'Created At',
      'Updated At',
    ];

    const csvRows = [headers.join(',')];

    for (const entry of entries) {
      const row = [
        entry.id,
        `"${entry.contactPhone}"`,
        `"${entry.contactName || ''}"`,
        entry.whitelistType,
        entry.confidenceScore,
        entry.isActive,
        entry.hitCount,
        entry.createdAt.toISOString(),
        entry.updatedAt.toISOString(),
      ];

      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  private async getWhitelistTypeStats(userId: string): Promise<Record<string, number>> {
    const types = ['manual', 'auto', 'temporary', 'learned'];
    const stats: Record<string, number> = {};

    for (const type of types) {
      const result = await whitelistService.getUserWhitelist(userId, {
        page: 1,
        limit: 1,
        type: type as any,
      });
      stats[type] = result.total;
    }

    return stats;
  }
}

export const whitelistController = new WhitelistController();
export default whitelistController;