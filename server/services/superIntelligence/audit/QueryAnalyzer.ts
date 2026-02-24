/**
 * SUPERINTELLIGENCE - Query Analyzer
 * Análisis avanzado de queries PostgreSQL
 * Tarea 4: Implementar análisis de queries PostgreSQL
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';
import { db } from '../../../db';
import { sql } from 'drizzle-orm';

// Tipos
export interface QueryRecord {
  timestamp: Date;
  queryHash: string;
  queryPattern: string;
  executionTime: number;
  rowsAffected: number;
  planningTime?: number;
  bufferHits?: number;
  bufferMisses?: number;
  tableName?: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER';
}

export interface QueryProfile {
  queryHash: string;
  queryPattern: string;
  operation: string;
  executionCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  p50ExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
  totalRowsAffected: number;
  averageRowsAffected: number;
  isSlowQuery: boolean;
  lastExecuted: Date;
  tables: string[];
}

export interface TableStats {
  tableName: string;
  rowCount: number;
  deadTuples: number;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
  seqScans: number;
  idxScans: number;
  seqScanRatio: number;
  estimatedBloat: number;
  indexUsageRatio: number;
}

export interface IndexStats {
  indexName: string;
  tableName: string;
  indexSize: number;
  scans: number;
  tupleReads: number;
  tupleFetches: number;
  isUnused: boolean;
  isDuplicate: boolean;
}

export interface QueryPlan {
  queryHash: string;
  plan: any;
  totalCost: number;
  actualTime: number;
  planningTime: number;
  executionTime: number;
  warnings: string[];
}

export interface QueryRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'index' | 'query' | 'table' | 'configuration';
  title: string;
  description: string;
  affectedQuery?: string;
  affectedTable?: string;
  suggestedAction: string;
  estimatedImpact: string;
}

export interface QueryAnalysisReport {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalQueries: number;
  slowQueries: number;
  averageExecutionTime: number;
  queryProfiles: QueryProfile[];
  tableStats: TableStats[];
  indexStats: IndexStats[];
  recommendations: QueryRecommendation[];
  healthScore: number;
}

// Umbrales
const THRESHOLDS = {
  slowQuery: 100, // ms
  verySlowQuery: 1000, // ms
  criticalQuery: 5000, // ms
  deadTuplesRatio: 0.1, // 10%
  seqScanThreshold: 1000, // rows
  unusedIndexThreshold: 100, // scans
  bloatThreshold: 0.2, // 20%
};

export class QueryAnalyzer extends EventEmitter {
  private static instance: QueryAnalyzer;
  private records: QueryRecord[] = [];
  private executionTimes: Map<string, number[]> = new Map();
  private readonly REDIS_PREFIX = 'query:analyzer:';
  private readonly MAX_RECORDS = 50000;
  private readonly MAX_EXECUTION_TIMES = 1000;

  private constructor() {
    super();
  }

  static getInstance(): QueryAnalyzer {
    if (!QueryAnalyzer.instance) {
      QueryAnalyzer.instance = new QueryAnalyzer();
    }
    return QueryAnalyzer.instance;
  }

  // Registrar una query
  record(
    queryPattern: string,
    executionTime: number,
    rowsAffected: number,
    options?: {
      planningTime?: number;
      bufferHits?: number;
      bufferMisses?: number;
      tableName?: string;
    }
  ): void {
    const queryHash = this.hashQuery(queryPattern);
    const operation = this.detectOperation(queryPattern);

    const record: QueryRecord = {
      timestamp: new Date(),
      queryHash,
      queryPattern: this.normalizeQuery(queryPattern),
      executionTime,
      rowsAffected,
      operation,
      ...options,
    };

    this.records.push(record);

    // Mantener límite
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-this.MAX_RECORDS);
    }

    // Actualizar tiempos de ejecución para estadísticas
    const times = this.executionTimes.get(queryHash) || [];
    times.push(executionTime);
    if (times.length > this.MAX_EXECUTION_TIMES) {
      times.shift();
    }
    this.executionTimes.set(queryHash, times);

    // Detectar slow queries
    if (executionTime > THRESHOLDS.verySlowQuery) {
      this.emit('slow-query', record);
      Logger.warn(`[QueryAnalyzer] Slow query detected: ${executionTime}ms - ${queryPattern.slice(0, 100)}...`);
    }
  }

  // Normalizar query (remover valores específicos)
  private normalizeQuery(query: string): string {
    return query
      // Normalizar strings
      .replace(/'[^']*'/g, "'?'")
      // Normalizar números
      .replace(/\b\d+\b/g, '?')
      // Normalizar UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '?')
      // Normalizar IN lists
      .replace(/IN\s*\([^)]+\)/gi, 'IN (?)')
      // Normalizar espacios
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Detectar operación
  private detectOperation(query: string): QueryRecord['operation'] {
    const normalized = query.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    return 'OTHER';
  }

  // Hash de query
  private hashQuery(query: string): string {
    const normalized = this.normalizeQuery(query);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // Generar perfiles de queries
  generateQueryProfiles(): QueryProfile[] {
    const profileMap = new Map<string, QueryRecord[]>();

    for (const record of this.records) {
      const existing = profileMap.get(record.queryHash) || [];
      existing.push(record);
      profileMap.set(record.queryHash, existing);
    }

    const profiles: QueryProfile[] = [];

    for (const [queryHash, records] of profileMap) {
      const times = records.map(r => r.executionTime).sort((a, b) => a - b);
      const totalTime = times.reduce((a, b) => a + b, 0);
      const totalRows = records.reduce((s, r) => s + r.rowsAffected, 0);

      // Extraer tablas
      const tables = new Set<string>();
      for (const r of records) {
        if (r.tableName) tables.add(r.tableName);
      }

      profiles.push({
        queryHash,
        queryPattern: records[0].queryPattern,
        operation: records[0].operation,
        executionCount: records.length,
        totalExecutionTime: totalTime,
        averageExecutionTime: totalTime / records.length,
        minExecutionTime: times[0],
        maxExecutionTime: times[times.length - 1],
        p50ExecutionTime: this.percentile(times, 50),
        p95ExecutionTime: this.percentile(times, 95),
        p99ExecutionTime: this.percentile(times, 99),
        totalRowsAffected: totalRows,
        averageRowsAffected: totalRows / records.length,
        isSlowQuery: totalTime / records.length > THRESHOLDS.slowQuery,
        lastExecuted: records[records.length - 1].timestamp,
        tables: Array.from(tables),
      });
    }

    return profiles.sort((a, b) => b.totalExecutionTime - a.totalExecutionTime);
  }

  // Obtener estadísticas de tablas
  async getTableStats(): Promise<TableStats[]> {
    try {
      const result = await db.execute(sql`
        SELECT
          schemaname,
          relname as table_name,
          n_live_tup as row_count,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_analyze,
          seq_scan,
          idx_scan,
          CASE WHEN seq_scan + idx_scan > 0
            THEN seq_scan::float / (seq_scan + idx_scan)
            ELSE 0
          END as seq_scan_ratio,
          pg_total_relation_size(relid) as total_size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 50
      `);

      return (result.rows as any[]).map(row => ({
        tableName: row.table_name,
        rowCount: parseInt(row.row_count) || 0,
        deadTuples: parseInt(row.dead_tuples) || 0,
        lastVacuum: row.last_vacuum ? new Date(row.last_vacuum) : null,
        lastAnalyze: row.last_analyze ? new Date(row.last_analyze) : null,
        seqScans: parseInt(row.seq_scan) || 0,
        idxScans: parseInt(row.idx_scan) || 0,
        seqScanRatio: parseFloat(row.seq_scan_ratio) || 0,
        estimatedBloat: row.dead_tuples / Math.max(row.row_count, 1),
        indexUsageRatio: row.idx_scan / Math.max(row.seq_scan + row.idx_scan, 1),
      }));
    } catch (error) {
      Logger.error('[QueryAnalyzer] Error fetching table stats:', error);
      return [];
    }
  }

  // Obtener estadísticas de índices
  async getIndexStats(): Promise<IndexStats[]> {
    try {
      const result = await db.execute(sql`
        SELECT
          indexrelname as index_name,
          relname as table_name,
          pg_relation_size(indexrelid) as index_size,
          idx_scan as scans,
          idx_tup_read as tuple_reads,
          idx_tup_fetch as tuple_fetches
        FROM pg_stat_user_indexes
        ORDER BY idx_scan ASC
        LIMIT 50
      `);

      return (result.rows as any[]).map(row => ({
        indexName: row.index_name,
        tableName: row.table_name,
        indexSize: parseInt(row.index_size) || 0,
        scans: parseInt(row.scans) || 0,
        tupleReads: parseInt(row.tuple_reads) || 0,
        tupleFetches: parseInt(row.tuple_fetches) || 0,
        isUnused: parseInt(row.scans) < THRESHOLDS.unusedIndexThreshold,
        isDuplicate: false, // Requiere análisis más profundo
      }));
    } catch (error) {
      Logger.error('[QueryAnalyzer] Error fetching index stats:', error);
      return [];
    }
  }

  // Analizar plan de query
  async analyzeQueryPlan(query: string): Promise<QueryPlan | null> {
    try {
      const queryHash = this.hashQuery(query);
      const startTime = Date.now();

      const result = await db.execute(sql.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`));
      const executionTime = Date.now() - startTime;

      const plan = (result.rows as any[])[0]['QUERY PLAN'][0];
      const warnings: string[] = [];

      // Detectar problemas comunes
      if (plan.Plan && plan.Plan['Node Type'] === 'Seq Scan') {
        const rows = plan.Plan['Actual Rows'] || 0;
        if (rows > THRESHOLDS.seqScanThreshold) {
          warnings.push(`Sequential scan on ${rows} rows - consider adding an index`);
        }
      }

      // Detectar nested loops costosos
      if (JSON.stringify(plan).includes('Nested Loop') && plan['Actual Total Time'] > 100) {
        warnings.push('Expensive nested loop detected - consider query optimization');
      }

      return {
        queryHash,
        plan: plan.Plan,
        totalCost: plan.Plan?.['Total Cost'] || 0,
        actualTime: plan['Actual Total Time'] || 0,
        planningTime: plan['Planning Time'] || 0,
        executionTime,
        warnings,
      };
    } catch (error) {
      Logger.error('[QueryAnalyzer] Error analyzing query plan:', error);
      return null;
    }
  }

  // Generar recomendaciones
  async generateRecommendations(): Promise<QueryRecommendation[]> {
    const recommendations: QueryRecommendation[] = [];
    const profiles = this.generateQueryProfiles();
    const tableStats = await this.getTableStats();
    const indexStats = await this.getIndexStats();

    // Analizar slow queries
    const slowQueries = profiles.filter(p => p.isSlowQuery);
    for (const query of slowQueries.slice(0, 10)) {
      const severity = query.averageExecutionTime > THRESHOLDS.criticalQuery ? 'critical' :
                       query.averageExecutionTime > THRESHOLDS.verySlowQuery ? 'high' : 'medium';

      recommendations.push({
        priority: severity,
        category: 'query',
        title: `Slow query: avg ${query.averageExecutionTime.toFixed(0)}ms`,
        description: `Query pattern: ${query.queryPattern.slice(0, 100)}...`,
        affectedQuery: query.queryHash,
        suggestedAction: 'Review query plan and consider adding indexes or optimizing joins',
        estimatedImpact: `Could save ${(query.totalExecutionTime / 1000).toFixed(1)}s total execution time`,
      });
    }

    // Analizar tablas con alto bloat
    for (const table of tableStats) {
      if (table.estimatedBloat > THRESHOLDS.bloatThreshold) {
        recommendations.push({
          priority: 'medium',
          category: 'table',
          title: `High bloat on table ${table.tableName}`,
          description: `Estimated ${(table.estimatedBloat * 100).toFixed(1)}% bloat (${table.deadTuples} dead tuples)`,
          affectedTable: table.tableName,
          suggestedAction: 'Run VACUUM FULL or pg_repack',
          estimatedImpact: 'Improved query performance and reduced disk usage',
        });
      }

      // Tablas con muchos seq scans
      if (table.seqScanRatio > 0.8 && table.rowCount > THRESHOLDS.seqScanThreshold) {
        recommendations.push({
          priority: 'high',
          category: 'index',
          title: `High sequential scan ratio on ${table.tableName}`,
          description: `${(table.seqScanRatio * 100).toFixed(1)}% of scans are sequential (${table.rowCount} rows)`,
          affectedTable: table.tableName,
          suggestedAction: 'Add indexes for frequently queried columns',
          estimatedImpact: 'Significant query performance improvement',
        });
      }

      // Tablas sin vacuum reciente
      if (table.lastVacuum) {
        const daysSinceVacuum = (Date.now() - table.lastVacuum.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceVacuum > 7 && table.deadTuples > 10000) {
          recommendations.push({
            priority: 'medium',
            category: 'table',
            title: `Table ${table.tableName} needs vacuum`,
            description: `Last vacuum: ${daysSinceVacuum.toFixed(0)} days ago, ${table.deadTuples} dead tuples`,
            affectedTable: table.tableName,
            suggestedAction: 'Run VACUUM ANALYZE',
            estimatedImpact: 'Improved query planning and disk space reclamation',
          });
        }
      }
    }

    // Analizar índices no utilizados
    const unusedIndexes = indexStats.filter(i => i.isUnused && i.indexSize > 1024 * 1024); // > 1MB
    for (const index of unusedIndexes.slice(0, 5)) {
      recommendations.push({
        priority: 'low',
        category: 'index',
        title: `Unused index: ${index.indexName}`,
        description: `Only ${index.scans} scans, size: ${(index.indexSize / 1024 / 1024).toFixed(2)}MB`,
        affectedTable: index.tableName,
        suggestedAction: 'Consider dropping this index to save space and improve write performance',
        estimatedImpact: `Save ${(index.indexSize / 1024 / 1024).toFixed(2)}MB disk space`,
      });
    }

    // Analizar queries por operación
    const deleteQueries = profiles.filter(p => p.operation === 'DELETE' && p.executionCount > 100);
    if (deleteQueries.length > 0) {
      const totalDeleteTime = deleteQueries.reduce((s, q) => s + q.totalExecutionTime, 0);
      if (totalDeleteTime > 10000) {
        recommendations.push({
          priority: 'medium',
          category: 'query',
          title: 'High DELETE query load detected',
          description: `${deleteQueries.length} DELETE patterns, total time: ${(totalDeleteTime / 1000).toFixed(1)}s`,
          suggestedAction: 'Consider batch deletions or soft deletes for better performance',
          estimatedImpact: 'Reduced lock contention and better write performance',
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // Generar reporte completo
  async generateReport(periodHours: number = 24): Promise<QueryAnalysisReport> {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const periodRecords = this.records.filter(r => r.timestamp >= cutoff);

    const profiles = this.generateQueryProfiles();
    const tableStats = await this.getTableStats();
    const indexStats = await this.getIndexStats();
    const recommendations = await this.generateRecommendations();

    const slowQueries = profiles.filter(p => p.isSlowQuery).length;
    const totalTime = periodRecords.reduce((s, r) => s + r.executionTime, 0);

    // Calcular score de salud
    let healthScore = 100;
    healthScore -= Math.min(30, slowQueries * 2); // Penalizar por slow queries
    healthScore -= Math.min(20, recommendations.filter(r => r.priority === 'critical').length * 10);
    healthScore -= Math.min(15, recommendations.filter(r => r.priority === 'high').length * 5);

    return {
      generatedAt: new Date(),
      periodStart: cutoff,
      periodEnd: new Date(),
      totalQueries: periodRecords.length,
      slowQueries,
      averageExecutionTime: periodRecords.length > 0 ? totalTime / periodRecords.length : 0,
      queryProfiles: profiles.slice(0, 50), // Top 50
      tableStats,
      indexStats,
      recommendations,
      healthScore: Math.max(0, healthScore),
    };
  }

  // Utilidades
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const index = Math.ceil((p / 100) * values.length) - 1;
    return values[Math.max(0, index)];
  }

  // Persistir datos
  async persist(): Promise<void> {
    try {
      await redis.setex(
        `${this.REDIS_PREFIX}records`,
        24 * 60 * 60,
        JSON.stringify(this.records.slice(-10000))
      );
      Logger.info('[QueryAnalyzer] Data persisted to Redis');
    } catch (error) {
      Logger.error('[QueryAnalyzer] Error persisting:', error);
    }
  }

  // Restaurar datos
  async restore(): Promise<void> {
    try {
      const data = await redis.get(`${this.REDIS_PREFIX}records`);
      if (data) {
        this.records = JSON.parse(data).map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
        Logger.info('[QueryAnalyzer] Data restored from Redis');
      }
    } catch (error) {
      Logger.error('[QueryAnalyzer] Error restoring:', error);
    }
  }

  // Reset
  reset(): void {
    this.records = [];
    this.executionTimes.clear();
  }

  // Estado
  getStatus(): { totalRecords: number; uniqueQueries: number; slowQueries: number } {
    const profiles = this.generateQueryProfiles();
    return {
      totalRecords: this.records.length,
      uniqueQueries: profiles.length,
      slowQueries: profiles.filter(p => p.isSlowQuery).length,
    };
  }
}

// Singleton export
export const queryAnalyzer = QueryAnalyzer.getInstance();
