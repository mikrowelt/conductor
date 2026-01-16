/**
 * Subproject Detector
 *
 * Detects subprojects in a monorepo structure.
 */

import { glob } from 'glob';
import { createLogger, DEFAULT_CONFIG } from '@conductor/core';
import type { ConductorConfig, SubprojectDefinition } from '@conductor/core';

const logger = createLogger('subproject-detector');

export class SubprojectDetector {
  private config: ConductorConfig | null;

  constructor(config: ConductorConfig | null) {
    this.config = config;
  }

  /**
   * Detect subprojects from a list of file paths
   */
  detectFromFileList(files: string[]): string[] {
    // If explicit subprojects are configured, use those
    if (this.config?.subprojects.explicit?.length) {
      return this.config.subprojects.explicit.map((s) => s.path);
    }

    // If auto-detect is disabled, return root only
    if (this.config?.subprojects.autoDetect.enabled === false) {
      return ['.'];
    }

    const patterns =
      this.config?.subprojects.autoDetect.patterns ||
      DEFAULT_CONFIG.subprojects.autoDetect.patterns;

    const subprojects = new Set<string>();

    for (const file of files) {
      for (const pattern of patterns) {
        if (this.matchesPattern(file, pattern)) {
          const subprojectPath = this.extractSubprojectPath(file, pattern);
          if (subprojectPath) {
            subprojects.add(subprojectPath);
          }
        }
      }
    }

    // If no subprojects detected, return root
    if (subprojects.size === 0) {
      return ['.'];
    }

    return Array.from(subprojects).sort();
  }

  /**
   * Detect subprojects by scanning the filesystem
   */
  async detectFromFilesystem(rootPath: string): Promise<SubprojectDefinition[]> {
    const patterns =
      this.config?.subprojects.autoDetect.patterns ||
      DEFAULT_CONFIG.subprojects.autoDetect.patterns;

    const subprojects: SubprojectDefinition[] = [];

    for (const pattern of patterns) {
      // Convert pattern to glob pattern for package.json files
      const globPattern = `${pattern}/package.json`;

      const matches = await glob(globPattern, {
        cwd: rootPath,
        absolute: false,
      });

      for (const match of matches) {
        const path = match.replace('/package.json', '');
        const name = path.split('/').pop() || path;

        subprojects.push({
          path,
          name,
          // Language detection could be added here
        });
      }
    }

    logger.info({ count: subprojects.length }, 'Detected subprojects');

    return subprojects;
  }

  /**
   * Check if a file path matches a subproject pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // packages/* -> packages/[^/]+
    const regexPattern = pattern
      .replace(/\*/g, '[^/]+')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}`);
    return regex.test(filePath);
  }

  /**
   * Extract the subproject path from a file path based on pattern
   */
  private extractSubprojectPath(
    filePath: string,
    pattern: string
  ): string | null {
    // packages/*/src/file.ts with pattern packages/* -> packages/name
    const parts = pattern.split('/');
    const fileParts = filePath.split('/');

    const result: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '*') {
        if (fileParts[i]) {
          result.push(fileParts[i]);
        } else {
          return null;
        }
      } else {
        result.push(parts[i]);
      }
    }

    return result.join('/');
  }

  /**
   * Get the subproject for a given file path
   */
  getSubprojectForFile(filePath: string): string {
    const patterns =
      this.config?.subprojects.autoDetect.patterns ||
      DEFAULT_CONFIG.subprojects.autoDetect.patterns;

    for (const pattern of patterns) {
      if (this.matchesPattern(filePath, pattern)) {
        const subproject = this.extractSubprojectPath(filePath, pattern);
        if (subproject) {
          return subproject;
        }
      }
    }

    return '.';
  }
}
