/**
 * Conflict Resolver
 *
 * Resolves conflicts when multiple Sub-Agents modify the same files.
 */

import { createLogger } from '@conductor/core';
import type { FileConflict, SharedContext } from '@conductor/core';

const logger = createLogger('conflict-resolver');

export interface ConflictResolution {
  file: string;
  strategy: 'merge' | 'priority' | 'manual';
  resolvedBy?: string;
  notes?: string;
}

export class ConflictResolver {
  /**
   * Analyze conflicts and determine resolution strategies
   */
  analyzeConflicts(context: SharedContext): ConflictResolution[] {
    const resolutions: ConflictResolution[] = [];

    for (const conflict of context.conflicts) {
      const resolution = this.determineStrategy(conflict, context);
      resolutions.push(resolution);
    }

    return resolutions;
  }

  /**
   * Determine the best resolution strategy for a conflict
   */
  private determineStrategy(
    conflict: FileConflict,
    context: SharedContext
  ): ConflictResolution {
    const { file, subprojects } = conflict;

    // Check file type for strategy hints
    if (this.isConfigFile(file)) {
      // Config files typically need manual merge
      return {
        file,
        strategy: 'manual',
        notes: 'Configuration files require careful manual merge',
      };
    }

    if (this.isLockFile(file)) {
      // Lock files should be regenerated
      return {
        file,
        strategy: 'manual',
        notes: 'Lock file should be regenerated after all changes',
      };
    }

    if (this.isSharedUtility(file)) {
      // Shared utilities - merge if possible
      return {
        file,
        strategy: 'merge',
        notes: 'Attempt automatic merge of shared utility changes',
      };
    }

    // Check if changes are additive (different parts of the file)
    const isAdditive = this.checkIfAdditive(file, subprojects, context);

    if (isAdditive) {
      return {
        file,
        strategy: 'merge',
        notes: 'Changes appear to be additive and can be merged',
      };
    }

    // Default to priority-based resolution
    // The subproject that was listed first in the decomposition wins
    return {
      file,
      strategy: 'priority',
      resolvedBy: subprojects[0],
      notes: `Priority given to ${subprojects[0]} (first in decomposition order)`,
    };
  }

  /**
   * Check if a file is a configuration file
   */
  private isConfigFile(file: string): boolean {
    const configPatterns = [
      /package\.json$/,
      /tsconfig.*\.json$/,
      /\.eslintrc/,
      /\.prettierrc/,
      /\.env/,
      /config\.(js|ts|json|yaml|yml)$/,
    ];

    return configPatterns.some((pattern) => pattern.test(file));
  }

  /**
   * Check if a file is a lock file
   */
  private isLockFile(file: string): boolean {
    const lockPatterns = [
      /package-lock\.json$/,
      /pnpm-lock\.yaml$/,
      /yarn\.lock$/,
      /Cargo\.lock$/,
      /Gemfile\.lock$/,
    ];

    return lockPatterns.some((pattern) => pattern.test(file));
  }

  /**
   * Check if a file is a shared utility
   */
  private isSharedUtility(file: string): boolean {
    const sharedPatterns = [
      /\/shared\//,
      /\/common\//,
      /\/utils\//,
      /\/helpers\//,
      /\/lib\//,
    ];

    return sharedPatterns.some((pattern) => pattern.test(file));
  }

  /**
   * Check if changes from different subprojects are additive
   * (modifying different parts of the file)
   */
  private checkIfAdditive(
    _file: string,
    _subprojects: string[],
    _context: SharedContext
  ): boolean {
    // This would require analyzing the actual diffs
    // For now, return false to be conservative
    // TODO: Implement actual diff analysis

    return false;
  }

  /**
   * Attempt to merge changes from multiple subprojects
   */
  async attemptMerge(
    _file: string,
    _changes: Map<string, string>
  ): Promise<{ success: boolean; merged?: string; error?: string }> {
    // This would use git merge or a similar tool
    // TODO: Implement actual merge logic

    logger.warn('Automatic merge not yet implemented');

    return {
      success: false,
      error: 'Automatic merge not yet implemented',
    };
  }

  /**
   * Generate a report of all conflicts and their resolutions
   */
  generateReport(resolutions: ConflictResolution[]): string {
    if (resolutions.length === 0) {
      return 'No conflicts detected.';
    }

    const lines = ['# Conflict Resolution Report', ''];

    for (const resolution of resolutions) {
      lines.push(`## ${resolution.file}`);
      lines.push(`- **Strategy:** ${resolution.strategy}`);

      if (resolution.resolvedBy) {
        lines.push(`- **Resolved by:** ${resolution.resolvedBy}`);
      }

      if (resolution.notes) {
        lines.push(`- **Notes:** ${resolution.notes}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}
