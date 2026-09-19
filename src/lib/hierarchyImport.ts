import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getPool } from "@/lib/db/connection";

export interface ImportWarning {
  index: number;
  message: string;
}

export interface ImportResult {
  rowsRead: number;
  levelsImported: number;
  warnings: ImportWarning[];
}

interface HierarchyImportOptions {
  /** File name at the project root, e.g. "custgroup.json". */
  fileName: string;
  /** Top-level array key in the file, e.g. "custGrpList". */
  listKey: string;
  /** Field name prefix, e.g. "custgrp" for custgrpcode1/custgrpname1. */
  fieldPrefix: string;
  /** Target table — must have (level, code, parent_code, name) columns and a UNIQUE (level, code). */
  tableName: string;
  /** How many levelN fields to look for (3 for customer groups, 6 for item categories). */
  maxLevels: number;
}

/**
 * Generic importer for a manually-maintained N-level code/name hierarchy
 * file (customer groups, item categories) into its matching MySQL table.
 * Used where the SAP master tables behind the hierarchy aren't reachable
 * via Service Layer, so the file is the authoritative source instead of a
 * SAP sync — always overwrites name/parent_code (never touches other
 * columns like is_sellable) for whatever codes the file lists; codes
 * discovered elsewhere (e.g. from real customers/items) and not yet in the
 * file are left untouched.
 */
export async function importHierarchyFromFile(options: HierarchyImportOptions): Promise<ImportResult> {
  const { fileName, listKey, fieldPrefix, tableName, maxLevels } = options;

  const filePath = join(/*turbopackIgnore: true*/ process.cwd(), fileName);
  if (!existsSync(filePath)) {
    throw new Error(`${fileName} not found in project root`);
  }

  const raw = readFileSync(filePath, "utf-8");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const list = data[listKey];
  if (!Array.isArray(list)) {
    throw new Error(`${fileName} must have a top-level "${listKey}" array`);
  }

  const warnings: ImportWarning[] = [];
  let levelsImported = 0;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (let index = 0; index < list.length; index++) {
      const entry = list[index] as Record<string, string | undefined>;
      const levels: { code?: string; name?: string }[] = [];
      for (let level = 1; level <= maxLevels; level++) {
        levels.push({ code: entry[`${fieldPrefix}code${level}`], name: entry[`${fieldPrefix}name${level}`] });
      }

      let parent: string | null = null;
      let sawGap = false;

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        const level = i + 1;

        if (!lvl.code) {
          if (levels.slice(i + 1).some((l) => l.code)) {
            warnings.push({
              index,
              message: `Row ${index}: level ${level} code is missing but a deeper level is present — chain broken from here`,
            });
          }
          sawGap = true;
          continue;
        }
        if (sawGap) continue; // don't attach a deeper level to a broken chain

        if (!lvl.name) {
          warnings.push({ index, message: `Row ${index}: level ${level} code "${lvl.code}" has no name` });
        }

        await conn.execute(
          `INSERT INTO ${tableName} (level, code, parent_code, name) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE parent_code = VALUES(parent_code), name = VALUES(name)`,
          [level, lvl.code, parent, lvl.name || null]
        );
        levelsImported++;
        parent = lvl.code;
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return { rowsRead: list.length, levelsImported, warnings };
}
