import { Logger } from "../../lib/logger";
import { pool } from "../../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartitionInfo {
  partitionName: string;
  parentTable: string;
  rangeFrom: string;
  rangeTo: string;
  estimatedRows: number;
  sizePretty: string;
}

export interface PartitionStats {
  partitionName: string;
  liveRows: number;
  deadRows: number;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
  sizePretty: string;
  indexSizePretty: string;
}

export interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
}

// ---------------------------------------------------------------------------
// TablePartitioningManager
// ---------------------------------------------------------------------------

class TablePartitioningManager {
  // Tables eligible for time-based partitioning
  private readonly partitionableTables = [
    "messages",
    "events",
    "audit_logs",
    "analytics",
  ] as const;

  // ---------------------------------------------------------------------------
  // DDL generators
  // ---------------------------------------------------------------------------

  generateCreatePartitionSQL(
    tableName: string,
    year: number,
    month: number
  ): string {
    const partitionName = this.buildPartitionName(tableName, year, month);
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const toDate = this.nextMonthDate(year, month);
    return (
      `CREATE TABLE IF NOT EXISTS ${partitionName} ` +
      `PARTITION OF ${tableName} ` +
      `FOR VALUES FROM ('${fromDate}') TO ('${toDate}')`
    );
  }

  generatePartitionedTableSQL(tableName: string, columns: ColumnDef[]): string {
    const colDefs = columns
      .map((c) => {
        let def = `  ${c.name} ${c.type}`;
        if (!c.nullable) def += " NOT NULL";
        if (c.default) def += ` DEFAULT ${c.default}`;
        return def;
      })
      .join(",\n");

    return (
      `CREATE TABLE IF NOT EXISTS ${tableName} (\n${colDefs}\n) ` +
      `PARTITION BY RANGE (created_at)`
    );
  }

  // ---------------------------------------------------------------------------
  // Partition management
  // ---------------------------------------------------------------------------

  async createMonthlyPartition(
    tableName: string,
    year: number,
    month: number
  ): Promise<void> {
    const sql = this.generateCreatePartitionSQL(tableName, year, month);
    const partitionName = this.buildPartitionName(tableName, year, month);

    try {
      await pool.query(sql);
      Logger.info(`[Partitioning] Created partition: ${partitionName}`);

      // Create index on the partition for common query patterns
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_${partitionName}_created_at ` +
        `ON ${partitionName} (created_at)`
      );
    } catch (err: any) {
      if (err.code === "42P07") {
        Logger.debug(`[Partitioning] Partition ${partitionName} already exists`);
        return;
      }
      Logger.error(`[Partitioning] Failed to create partition ${partitionName}`, err);
      throw err;
    }
  }

  async createFuturePartitions(
    tableName: string,
    monthsAhead: number = 3
  ): Promise<void> {
    const now = new Date();
    for (let i = 0; i <= monthsAhead; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      await this.createMonthlyPartition(
        tableName,
        target.getFullYear(),
        target.getMonth() + 1
      );
    }
  }

  async listPartitions(tableName: string): Promise<PartitionInfo[]> {
    const result = await pool.query<{
      partitionname: string;
      parenttable: string;
      range_from: string;
      range_to: string;
      estimated_rows: string;
      size_pretty: string;
    }>(
      `SELECT
         child.relname                                   AS partitionname,
         parent.relname                                  AS parenttable,
         pg_get_expr(child.relpartbound, child.oid, true) AS range_info,
         pg_size_pretty(pg_total_relation_size(child.oid)) AS size_pretty,
         (SELECT reltuples::bigint FROM pg_class WHERE oid = child.oid) AS estimated_rows,
         '' AS range_from,
         '' AS range_to
       FROM pg_inherits
       JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
       JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
       WHERE parent.relname = $1
       ORDER BY child.relname`,
      [tableName]
    );

    return result.rows.map((r) => ({
      partitionName: r.partitionname,
      parentTable: r.parenttable,
      rangeFrom: r.range_from,
      rangeTo: r.range_to,
      estimatedRows: parseInt(r.estimated_rows ?? "0", 10),
      sizePretty: r.size_pretty,
    }));
  }

  async archiveOldPartitions(
    tableName: string,
    retainMonths: number = 12
  ): Promise<void> {
    const partitions = await this.listPartitions(tableName);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - retainMonths);

    for (const partition of partitions) {
      // Extract year/month from partition name pattern: tableName_YYYY_MM
      const match = partition.partitionName.match(/_(\d{4})_(\d{2})$/);
      if (!match) continue;

      const partYear = parseInt(match[1], 10);
      const partMonth = parseInt(match[2], 10);
      const partDate = new Date(partYear, partMonth - 1, 1);

      if (partDate < cutoff) {
        Logger.info(
          `[Partitioning] Archiving old partition: ${partition.partitionName}`
        );
        await this.dropArchivedPartition(partition.partitionName);
      }
    }
  }

  async dropArchivedPartition(partitionName: string): Promise<void> {
    // Safety: only allow dropping partitions that match expected naming
    if (!/^[a-z_]+_\d{4}_\d{2}$/.test(partitionName)) {
      throw new Error(
        `[Partitioning] Refusing to drop partition with unexpected name: ${partitionName}`
      );
    }

    try {
      await pool.query(`DROP TABLE IF EXISTS ${partitionName}`);
      Logger.info(`[Partitioning] Dropped partition: ${partitionName}`);
    } catch (err) {
      Logger.error(`[Partitioning] Failed to drop partition ${partitionName}`, err);
      throw err;
    }
  }

  async getPartitionStats(tableName: string): Promise<PartitionStats[]> {
    const result = await pool.query<{
      relname: string;
      n_live_tup: string;
      n_dead_tup: string;
      last_vacuum: Date | null;
      last_analyze: Date | null;
      size_pretty: string;
      index_size_pretty: string;
    }>(
      `SELECT
         c.relname,
         s.n_live_tup,
         s.n_dead_tup,
         s.last_vacuum,
         s.last_analyze,
         pg_size_pretty(pg_relation_size(c.oid))        AS size_pretty,
         pg_size_pretty(pg_indexes_size(c.oid))         AS index_size_pretty
       FROM pg_inherits
       JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
       JOIN pg_class c      ON pg_inherits.inhrelid  = c.oid
       LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname
       WHERE parent.relname = $1
       ORDER BY c.relname`,
      [tableName]
    );

    return result.rows.map((r) => ({
      partitionName: r.relname,
      liveRows: parseInt(r.n_live_tup ?? "0", 10),
      deadRows: parseInt(r.n_dead_tup ?? "0", 10),
      lastVacuum: r.last_vacuum,
      lastAnalyze: r.last_analyze,
      sizePretty: r.size_pretty,
      indexSizePretty: r.index_size_pretty,
    }));
  }

  /**
   * Converts an existing non-partitioned table to a partitioned one.
   * This is a multi-step operation requiring a maintenance window.
   */
  async migrateToPartitioned(
    tableName: string,
    partitionKey: string = "created_at"
  ): Promise<void> {
    const tempName = `${tableName}_old_${Date.now()}`;

    Logger.info(
      `[Partitioning] Starting migration of ${tableName} to partitioned table`
    );

    await pool.query(`BEGIN`);
    try {
      // Rename original table
      await pool.query(`ALTER TABLE ${tableName} RENAME TO ${tempName}`);

      // Get column definitions from the original table
      const colResult = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [tempName]
      );

      const columns: ColumnDef[] = colResult.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        default: c.column_default ?? undefined,
      }));

      // Create partitioned table
      const createSQL = this.generatePartitionedTableSQL(tableName, columns);
      await pool.query(createSQL);

      // Create current + 3 future partitions
      await this.createFuturePartitions(tableName, 3);

      // Copy data
      await pool.query(`INSERT INTO ${tableName} SELECT * FROM ${tempName}`);

      await pool.query(`COMMIT`);
      Logger.info(`[Partitioning] Migration complete for ${tableName}`);
    } catch (err) {
      await pool.query(`ROLLBACK`);
      Logger.error(`[Partitioning] Migration failed for ${tableName}`, err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Maintenance job
  // ---------------------------------------------------------------------------

  async runMaintenanceJob(): Promise<void> {
    Logger.info("[Partitioning] Running maintenance job");

    for (const table of this.partitionableTables) {
      try {
        // Ensure we have partitions for the next 3 months
        await this.createFuturePartitions(table, 3);

        // Retain 18 months of data by default
        await this.archiveOldPartitions(table, 18);
      } catch (err) {
        Logger.error(
          `[Partitioning] Maintenance failed for table ${table}`,
          err
        );
      }
    }

    Logger.info("[Partitioning] Maintenance job completed");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildPartitionName(
    tableName: string,
    year: number,
    month: number
  ): string {
    return `${tableName}_${year}_${String(month).padStart(2, "0")}`;
  }

  private nextMonthDate(year: number, month: number): string {
    const d = new Date(year, month, 1); // month is 0-indexed in Date
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }
}

export const partitioningManager = new TablePartitioningManager();
