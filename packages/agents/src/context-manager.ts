/**
 * Context Manager
 *
 * Manages shared context between agents for a task.
 */

import { createLogger } from '@conductor/core';
import type { SharedContext, RequirementsUpdate, FileConflict } from '@conductor/core';

const logger = createLogger('context-manager');

export class ContextManager {
  private context: SharedContext;
  private taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
    this.context = {
      requirementsUpdates: [],
      modifiedFiles: new Map(),
      conflicts: [],
    };
  }

  /**
   * Record a requirements update from a subproject
   */
  recordRequirementsUpdate(update: Omit<RequirementsUpdate, 'timestamp'>): void {
    const fullUpdate: RequirementsUpdate = {
      ...update,
      timestamp: new Date(),
    };

    this.context.requirementsUpdates.push(fullUpdate);

    logger.info(
      {
        taskId: this.taskId,
        subproject: update.subprojectPath,
        file: update.file,
      },
      'Requirements update recorded'
    );
  }

  /**
   * Record files modified by a subproject
   */
  recordModifiedFiles(subprojectPath: string, files: string[]): void {
    const existing = this.context.modifiedFiles.get(subprojectPath) || [];
    const combined = [...new Set([...existing, ...files])];
    this.context.modifiedFiles.set(subprojectPath, combined);

    // Check for conflicts
    this.detectConflicts(files);
  }

  /**
   * Detect if multiple subprojects modified the same file
   */
  private detectConflicts(newFiles: string[]): void {
    for (const file of newFiles) {
      const subprojectsModifyingFile: string[] = [];

      for (const [subproject, files] of this.context.modifiedFiles) {
        if (files.includes(file)) {
          subprojectsModifyingFile.push(subproject);
        }
      }

      if (subprojectsModifyingFile.length > 1) {
        // Check if we already have this conflict
        const existingConflict = this.context.conflicts.find(
          (c) => c.file === file
        );

        if (existingConflict) {
          // Update existing conflict
          existingConflict.subprojects = [
            ...new Set([
              ...existingConflict.subprojects,
              ...subprojectsModifyingFile,
            ]),
          ];
        } else {
          // Create new conflict
          this.context.conflicts.push({
            file,
            subprojects: subprojectsModifyingFile,
            resolutionStrategy: 'merge', // Default strategy
          });

          logger.warn(
            {
              taskId: this.taskId,
              file,
              subprojects: subprojectsModifyingFile,
            },
            'File conflict detected'
          );
        }
      }
    }
  }

  /**
   * Get all requirements updates
   */
  getRequirementsUpdates(): RequirementsUpdate[] {
    return this.context.requirementsUpdates;
  }

  /**
   * Get requirements updates that other subprojects should know about
   */
  getUpdatesForSubproject(subprojectPath: string): RequirementsUpdate[] {
    // Return updates from OTHER subprojects that might affect this one
    return this.context.requirementsUpdates.filter(
      (u) => u.subprojectPath !== subprojectPath
    );
  }

  /**
   * Get all file conflicts
   */
  getConflicts(): FileConflict[] {
    return this.context.conflicts;
  }

  /**
   * Check if there are any conflicts
   */
  hasConflicts(): boolean {
    return this.context.conflicts.length > 0;
  }

  /**
   * Get all modified files across all subprojects
   */
  getAllModifiedFiles(): string[] {
    const allFiles: string[] = [];
    for (const files of this.context.modifiedFiles.values()) {
      allFiles.push(...files);
    }
    return [...new Set(allFiles)];
  }

  /**
   * Set conflict resolution strategy
   */
  setConflictResolution(
    file: string,
    strategy: FileConflict['resolutionStrategy']
  ): void {
    const conflict = this.context.conflicts.find((c) => c.file === file);
    if (conflict) {
      conflict.resolutionStrategy = strategy;
    }
  }

  /**
   * Get the full shared context
   */
  getContext(): SharedContext {
    return this.context;
  }

  /**
   * Generate a summary of the context for logging
   */
  getSummary(): {
    requirementsUpdates: number;
    modifiedFileCount: number;
    conflictCount: number;
    subprojectsWithChanges: number;
  } {
    return {
      requirementsUpdates: this.context.requirementsUpdates.length,
      modifiedFileCount: this.getAllModifiedFiles().length,
      conflictCount: this.context.conflicts.length,
      subprojectsWithChanges: this.context.modifiedFiles.size,
    };
  }
}
