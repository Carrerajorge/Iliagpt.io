import { Logger } from "../lib/logger";
import { pool } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TenantRecord = { tenantId: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// TenantDatabase
// ---------------------------------------------------------------------------

class TenantDatabase {

  // ---------------------------------------------------------------------------
  // Row-Level Security helpers
  // ---------------------------------------------------------------------------

  async setRowLevelSecurity(tableName: string): Promise<void> {
    this.assertSafeIdentifier(tableName);
    await this.enableRLS(tableName);
    await this.createTenantPolicy(tableName, `${tableName}_tenant_isolation`);
  }

  async enableRLS(tableName: string): Promise<void> {
    this.assertSafeIdentifier(tableName);
    await pool.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
    Logger.info(`[TenantDatabase] RLS enabled on ${tableName}`);
  }

  async disableRLS(tableName: string): Promise<void> {
    this.assertSafeIdentifier(tableName);
    await pool.query(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY`);
    Logger.info(`[TenantDatabase] RLS disabled on ${tableName}`);
  }

  async createTenantPolicy(tableName: string, policyName: string): Promise<void> {
    this.assertSafeIdentifier(tableName);
    this.assertSafeIdentifier(policyName);

    const sql = this.generateRLSPolicy(tableName, policyName);

    // Drop existing policy first (idempotent)
    try {
      await pool.query(`DROP POLICY IF EXISTS ${policyName} ON ${tableName}`);
    } catch {
      // ignore
    }

    await pool.query(sql);
    Logger.info(`[TenantDatabase] Created RLS policy ${policyName} on ${tableName}`);
  }

  generateRLSPolicy(tableName: string, policyName: string = `${tableName}_tenant_iso`): string {
    this.assertSafeIdentifier(tableName);
    this.assertSafeIdentifier(policyName);

    return (
      `CREATE POLICY ${policyName} ON ${tableName} ` +
      `USING (tenant_id = current_setting('app.tenant_id', true)) ` +
      `WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`
    );
  }

  // ---------------------------------------------------------------------------
  // Scoped query builders (auto-inject tenant_id = ?)
  // ---------------------------------------------------------------------------

  async findMany<T = TenantRecord>(
    tableName: string,
    tenantId: string,
    conditions: Record<string, unknown> = {}
  ): Promise<T[]> {
    this.assertSafeIdentifier(tableName);

    const whereClauses: string[] = ["tenant_id = $1"];
    const values: unknown[] = [tenantId];
    let paramIdx = 2;

    for (const [col, val] of Object.entries(conditions)) {
      this.assertSafeIdentifier(col);
      whereClauses.push(`${col} = $${paramIdx++}`);
      values.push(val);
    }

    const result = await pool.query<T>(
      `SELECT * FROM ${tableName} WHERE ${whereClauses.join(" AND ")} ORDER BY created_at DESC`,
      values
    );
    return result.rows;
  }

  async findOne<T = TenantRecord>(
    tableName: string,
    tenantId: string,
    id: string
  ): Promise<T | null> {
    this.assertSafeIdentifier(tableName);

    const result = await pool.query<T>(
      `SELECT * FROM ${tableName} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    return result.rows[0] ?? null;
  }

  async insert<T = TenantRecord>(
    tableName: string,
    tenantId: string,
    data: Omit<T, "tenantId">
  ): Promise<T> {
    this.assertSafeIdentifier(tableName);

    const record: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
      tenant_id: tenantId,
      id: (data as any).id ?? crypto.randomUUID(),
      created_at: (data as any).created_at ?? new Date(),
      updated_at: new Date(),
    };

    const cols = Object.keys(record).map((c) => {
      this.assertSafeIdentifier(c);
      return c;
    });
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const values = Object.values(record);

    const result = await pool.query<T>(
      `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async update<T = TenantRecord>(
    tableName: string,
    tenantId: string,
    id: string,
    data: Partial<T>
  ): Promise<T> {
    this.assertSafeIdentifier(tableName);

    const record: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
      updated_at: new Date(),
    };

    // Prevent overriding ownership
    delete record["tenant_id"];
    delete record["id"];

    const setClauses = Object.keys(record).map((col, i) => {
      this.assertSafeIdentifier(col);
      return `${col} = $${i + 3}`;
    });
    const values = [tenantId, id, ...Object.values(record)];

    const result = await pool.query<T>(
      `UPDATE ${tableName} SET ${setClauses.join(", ")}
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Record ${id} not found in ${tableName} for tenant ${tenantId}`
      );
    }
    return result.rows[0];
  }

  async delete(
    tableName: string,
    tenantId: string,
    id: string
  ): Promise<void> {
    this.assertSafeIdentifier(tableName);

    const result = await pool.query(
      `DELETE FROM ${tableName} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );

    if (result.rowCount === 0) {
      throw new Error(
        `Record ${id} not found in ${tableName} for tenant ${tenantId}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Migration tools
  // ---------------------------------------------------------------------------

  async addTenantIdColumn(tableName: string): Promise<void> {
    this.assertSafeIdentifier(tableName);
    await pool.query(`
      ALTER TABLE ${tableName}
      ADD COLUMN IF NOT EXISTS tenant_id TEXT
    `);
    Logger.info(`[TenantDatabase] Added tenant_id column to ${tableName}`);
  }

  async backfillTenantId(
    tableName: string,
    defaultTenantId: string
  ): Promise<void> {
    this.assertSafeIdentifier(tableName);
    const result = await pool.query(
      `UPDATE ${tableName} SET tenant_id = $1 WHERE tenant_id IS NULL`,
      [defaultTenantId]
    );
    Logger.info(
      `[TenantDatabase] Backfilled ${result.rowCount} rows in ${tableName} with tenant ${defaultTenantId}`
    );
  }

  // ---------------------------------------------------------------------------
  // Data portability
  // ---------------------------------------------------------------------------

  async exportTenantData(tenantId: string): Promise<Record<string, any[]>> {
    const tables = await this.getTablesWithTenantId();
    const export_: Record<string, any[]> = {};

    for (const table of tables) {
      const rows = await this.findMany(table, tenantId);
      export_[table] = rows;
    }

    Logger.info(
      `[TenantDatabase] Exported data for tenant ${tenantId} from ${tables.length} tables`
    );
    return export_;
  }

  async importTenantData(
    tenantId: string,
    data: Record<string, any[]>
  ): Promise<void> {
    for (const [tableName, rows] of Object.entries(data)) {
      if (!rows || rows.length === 0) continue;

      this.assertSafeIdentifier(tableName);

      for (const row of rows) {
        const record = { ...row, tenant_id: tenantId };
        const cols = Object.keys(record).map((c) => {
          this.assertSafeIdentifier(c);
          return c;
        });
        const placeholders = cols.map((_, i) => `$${i + 1}`);

        await pool.query(
          `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
           ON CONFLICT (id) DO NOTHING`,
          Object.values(record)
        ).catch((err) => {
          Logger.warn(
            `[TenantDatabase] Import skip row in ${tableName}: ${err.message}`
          );
        });
      }

      Logger.info(
        `[TenantDatabase] Imported ${rows.length} rows into ${tableName} for tenant ${tenantId}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getTablesWithTenantId(): Promise<string[]> {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.columns
       WHERE column_name = 'tenant_id'
         AND table_schema = 'public'`
    );
    return result.rows.map((r) => r.table_name);
  }

  /**
   * Defends against SQL injection in table/column identifiers.
   * Only allows alphanumeric characters and underscores.
   */
  private assertSafeIdentifier(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Unsafe SQL identifier: "${name}"`);
    }
  }
}

export const tenantDb = new TenantDatabase();
