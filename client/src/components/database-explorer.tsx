/**
 * Database Explorer Component - ILIAGPT PRO 3.0
 * 
 * Visual SQL query builder and data explorer.
 * Schema browser, query execution, and results table.
 */

import React, { useState, useCallback } from "react";

// ============== Types ==============

export interface DatabaseConfig {
    name: string;
    type: "postgresql" | "mysql" | "sqlite" | "mongodb";
    tables: TableSchema[];
}

export interface TableSchema {
    name: string;
    columns: ColumnSchema[];
    rowCount?: number;
}

export interface ColumnSchema {
    name: string;
    type: string;
    nullable: boolean;
    primaryKey?: boolean;
    foreignKey?: { table: string; column: string };
}

export interface QueryResult {
    columns: string[];
    rows: Record<string, any>[];
    rowCount: number;
    executionTime: number;
    error?: string;
}

interface QueryHistory {
    query: string;
    timestamp: Date;
    success: boolean;
    executionTime?: number;
}

// ============== Mock Data ==============

const MOCK_DATABASE: DatabaseConfig = {
    name: "iliagpt_db",
    type: "postgresql",
    tables: [
        {
            name: "users",
            columns: [
                { name: "id", type: "uuid", nullable: false, primaryKey: true },
                { name: "email", type: "varchar(255)", nullable: false },
                { name: "name", type: "varchar(100)", nullable: true },
                { name: "created_at", type: "timestamp", nullable: false },
                { name: "tier", type: "varchar(20)", nullable: false },
            ],
            rowCount: 15420,
        },
        {
            name: "chats",
            columns: [
                { name: "id", type: "uuid", nullable: false, primaryKey: true },
                { name: "user_id", type: "uuid", nullable: false, foreignKey: { table: "users", column: "id" } },
                { name: "title", type: "varchar(255)", nullable: true },
                { name: "created_at", type: "timestamp", nullable: false },
                { name: "model", type: "varchar(50)", nullable: false },
            ],
            rowCount: 89234,
        },
        {
            name: "messages",
            columns: [
                { name: "id", type: "uuid", nullable: false, primaryKey: true },
                { name: "chat_id", type: "uuid", nullable: false, foreignKey: { table: "chats", column: "id" } },
                { name: "role", type: "varchar(20)", nullable: false },
                { name: "content", type: "text", nullable: false },
                { name: "tokens", type: "integer", nullable: true },
                { name: "created_at", type: "timestamp", nullable: false },
            ],
            rowCount: 1245678,
        },
    ],
};

// ============== Component ==============

export function DatabaseExplorer() {
    const [database] = useState<DatabaseConfig>(MOCK_DATABASE);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [query, setQuery] = useState<string>("SELECT * FROM users LIMIT 10;");
    const [result, setResult] = useState<QueryResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [history, setHistory] = useState<QueryHistory[]>([]);
    const [activeTab, setActiveTab] = useState<"schema" | "history">("schema");

    // ======== Query Execution ========

    const executeQuery = useCallback(async () => {
        setIsExecuting(true);
        const startTime = Date.now();

        try {
            // Mock execution
            await new Promise(r => setTimeout(r, 300));

            const mockResult: QueryResult = {
                columns: ["id", "email", "name", "created_at", "tier"],
                rows: [
                    { id: "1a2b3c", email: "user1@example.com", name: "John Doe", created_at: "2024-01-15", tier: "pro" },
                    { id: "4d5e6f", email: "user2@example.com", name: "Jane Smith", created_at: "2024-02-20", tier: "free" },
                    { id: "7g8h9i", email: "user3@example.com", name: "Bob Wilson", created_at: "2024-03-10", tier: "pro" },
                ],
                rowCount: 3,
                executionTime: Date.now() - startTime,
            };

            setResult(mockResult);
            setHistory(h => [{
                query,
                timestamp: new Date(),
                success: true,
                executionTime: mockResult.executionTime,
            }, ...h.slice(0, 49)]);
        } catch (error) {
            setResult({
                columns: [],
                rows: [],
                rowCount: 0,
                executionTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : "Query failed",
            });
        } finally {
            setIsExecuting(false);
        }
    }, [query]);

    // ======== Quick Queries ========

    const generateSelectQuery = useCallback((tableName: string) => {
        setQuery(`SELECT * FROM ${tableName} LIMIT 100;`);
        setSelectedTable(tableName);
    }, []);

    const insertFromHistory = useCallback((q: string) => {
        setQuery(q);
    }, []);

    // ======== Render ========

    return (
        <div className="flex h-full bg-gray-900 text-white">
            {/* Sidebar */}
            <div className="w-64 border-r border-gray-700 flex flex-col">
                {/* Tabs */}
                <div className="flex border-b border-gray-700">
                    <button
                        className={`flex-1 px-4 py-2 text-sm ${activeTab === "schema" ? "bg-gray-800 text-blue-400" : "text-gray-400"}`}
                        onClick={() => setActiveTab("schema")}
                    >
                        📊 Schema
                    </button>
                    <button
                        className={`flex-1 px-4 py-2 text-sm ${activeTab === "history" ? "bg-gray-800 text-blue-400" : "text-gray-400"}`}
                        onClick={() => setActiveTab("history")}
                    >
                        📜 History
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-2">
                    {activeTab === "schema" ? (
                        <div className="space-y-2">
                            <div className="text-xs text-gray-500 uppercase px-2">
                                {database.name} ({database.type})
                            </div>
                            {database.tables.map(table => (
                                <div key={table.name}>
                                    <button
                                        className={`w-full text-left px-2 py-1 rounded text-sm flex items-center justify-between ${selectedTable === table.name ? "bg-blue-900 text-blue-300" : "hover:bg-gray-800"
                                            }`}
                                        onClick={() => {
                                            setSelectedTable(selectedTable === table.name ? null : table.name);
                                        }}
                                        onDoubleClick={() => generateSelectQuery(table.name)}
                                    >
                                        <span>🗃️ {table.name}</span>
                                        <span className="text-xs text-gray-500">{table.rowCount?.toLocaleString()}</span>
                                    </button>

                                    {selectedTable === table.name && (
                                        <div className="ml-4 mt-1 space-y-0.5">
                                            {table.columns.map(col => (
                                                <div
                                                    key={col.name}
                                                    className="text-xs py-0.5 px-2 flex items-center gap-2 text-gray-400"
                                                >
                                                    {col.primaryKey && <span className="text-yellow-400">🔑</span>}
                                                    {col.foreignKey && <span className="text-blue-400">🔗</span>}
                                                    <span className={col.primaryKey ? "text-yellow-300" : ""}>
                                                        {col.name}
                                                    </span>
                                                    <span className="text-gray-600">{col.type}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {history.map((h, i) => (
                                <button
                                    key={i}
                                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-800 truncate"
                                    onClick={() => insertFromHistory(h.query)}
                                >
                                    <span className={h.success ? "text-green-400" : "text-red-400"}>
                                        {h.success ? "✓" : "✕"}
                                    </span>
                                    <span className="ml-2 text-gray-300">{h.query.slice(0, 50)}</span>
                                    {h.executionTime && (
                                        <span className="ml-2 text-gray-600">{h.executionTime}ms</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col">
                {/* Query Editor */}
                <div className="border-b border-gray-700">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                        <span className="text-sm font-medium">SQL Query</span>
                        <button
                            onClick={executeQuery}
                            disabled={isExecuting}
                            className="px-4 py-1 bg-green-600 hover:bg-green-700 rounded text-sm font-medium disabled:opacity-50"
                        >
                            {isExecuting ? "⏳ Running..." : "▶ Execute"}
                        </button>
                    </div>
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full h-32 p-4 bg-gray-900 text-green-400 font-mono text-sm resize-none outline-none"
                        placeholder="SELECT * FROM table_name;"
                        spellCheck={false}
                    />
                </div>

                {/* Results */}
                <div className="flex-1 overflow-auto">
                    {result?.error ? (
                        <div className="p-4 text-red-400">
                            ❌ Error: {result.error}
                        </div>
                    ) : result ? (
                        <>
                            <div className="px-4 py-2 bg-gray-800 text-sm text-gray-400 flex justify-between">
                                <span>{result.rowCount} rows returned</span>
                                <span>{result.executionTime}ms</span>
                            </div>
                            <div className="overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800 sticky top-0">
                                        <tr>
                                            {result.columns.map(col => (
                                                <th key={col} className="px-4 py-2 text-left font-medium text-gray-300">
                                                    {col}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.rows.map((row, i) => (
                                            <tr key={i} className="border-b border-gray-800 hover:bg-gray-800">
                                                {result.columns.map(col => (
                                                    <td key={col} className="px-4 py-2 text-gray-300 font-mono">
                                                        {formatValue(row[col])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            Execute a query to see results
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatValue(value: any): string {
    if (value === null) return "NULL";
    if (value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

export default DatabaseExplorer;
