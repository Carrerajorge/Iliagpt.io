/**
 * API Tester Component - ILIAGPT PRO 3.0
 * 
 * Postman-like interface for testing APIs.
 * Request builder, response viewer, history.
 */

import React, { useState, useCallback } from "react";

// ============== Types ==============

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestConfig {
    method: HttpMethod;
    url: string;
    headers: { key: string; value: string; enabled: boolean }[];
    body: string;
    bodyType: "json" | "form" | "text" | "none";
}

interface ResponseData {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
    size: number;
}

interface RequestHistory {
    request: RequestConfig;
    response?: ResponseData;
    timestamp: Date;
}

// ============== Constants ==============

const METHOD_COLORS: Record<HttpMethod, string> = {
    GET: "bg-green-600",
    POST: "bg-blue-600",
    PUT: "bg-orange-500",
    PATCH: "bg-yellow-600",
    DELETE: "bg-red-600",
};

// ============== Component ==============

export function ApiTester() {
    const [request, setRequest] = useState<RequestConfig>({
        method: "GET",
        url: "https://api.example.com/users",
        headers: [
            { key: "Content-Type", value: "application/json", enabled: true },
            { key: "Authorization", value: "Bearer token", enabled: false },
        ],
        body: '{\n  "name": "Test"\n}',
        bodyType: "json",
    });

    const [response, setResponse] = useState<ResponseData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<"params" | "headers" | "body">("headers");
    const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
    const [history, setHistory] = useState<RequestHistory[]>([]);

    // ======== Request Execution ========

    const executeRequest = useCallback(async () => {
        setIsLoading(true);
        const startTime = Date.now();

        try {
            const headers: Record<string, string> = {};
            for (const h of request.headers) {
                if (h.enabled && h.key) {
                    headers[h.key] = h.value;
                }
            }

            const fetchOptions: RequestInit = {
                method: request.method,
                headers,
            };

            if (request.method !== "GET" && request.bodyType !== "none") {
                fetchOptions.body = request.body;
            }

            const res = await fetch(request.url, fetchOptions);
            const text = await res.text();

            const responseData: ResponseData = {
                status: res.status,
                statusText: res.statusText,
                headers: Object.fromEntries(res.headers.entries()),
                body: text,
                time: Date.now() - startTime,
                size: new Blob([text]).size,
            };

            setResponse(responseData);
            setHistory(h => [{ request: { ...request }, response: responseData, timestamp: new Date() }, ...h.slice(0, 49)]);
        } catch (error) {
            setResponse({
                status: 0,
                statusText: "Error",
                headers: {},
                body: error instanceof Error ? error.message : "Request failed",
                time: Date.now() - startTime,
                size: 0,
            });
        } finally {
            setIsLoading(false);
        }
    }, [request]);

    // ======== Header Management ========

    const addHeader = useCallback(() => {
        setRequest(r => ({
            ...r,
            headers: [...r.headers, { key: "", value: "", enabled: true }],
        }));
    }, []);

    const updateHeader = useCallback((index: number, field: "key" | "value" | "enabled", value: any) => {
        setRequest(r => ({
            ...r,
            headers: r.headers.map((h, i) =>
                i === index ? { ...h, [field]: value } : h
            ),
        }));
    }, []);

    const removeHeader = useCallback((index: number) => {
        setRequest(r => ({
            ...r,
            headers: r.headers.filter((_, i) => i !== index),
        }));
    }, []);

    // ======== Render ========

    return (
        <div className="flex h-full bg-gray-900 text-white">
            {/* Sidebar - History */}
            <div className="w-64 border-r border-gray-700 flex flex-col">
                <div className="p-2 border-b border-gray-700 text-sm font-medium">
                    📜 History
                </div>
                <div className="flex-1 overflow-auto">
                    {history.map((h, i) => (
                        <button
                            key={i}
                            className="w-full text-left px-2 py-1 hover:bg-gray-800 border-b border-gray-800"
                            onClick={() => setRequest(h.request)}
                        >
                            <div className="flex items-center gap-2">
                                <span className={`text-xs px-1 rounded ${METHOD_COLORS[h.request.method]}`}>
                                    {h.request.method}
                                </span>
                                <span className={`text-xs ${h.response?.status === 200 ? "text-green-400" : "text-red-400"}`}>
                                    {h.response?.status || "ERR"}
                                </span>
                            </div>
                            <div className="text-xs text-gray-400 truncate">{h.request.url}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col">
                {/* URL Bar */}
                <div className="p-4 border-b border-gray-700 flex gap-2">
                    <select
                        value={request.method}
                        onChange={(e) => setRequest(r => ({ ...r, method: e.target.value as HttpMethod }))}
                        className={`px-3 py-2 rounded font-bold text-white ${METHOD_COLORS[request.method]}`}
                    >
                        {Object.keys(METHOD_COLORS).map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <input
                        type="text"
                        value={request.url}
                        onChange={(e) => setRequest(r => ({ ...r, url: e.target.value }))}
                        placeholder="Enter request URL"
                        className="flex-1 px-4 py-2 bg-gray-800 rounded border border-gray-600 outline-none focus:border-blue-500"
                    />
                    <button
                        onClick={executeRequest}
                        disabled={isLoading}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium disabled:opacity-50"
                    >
                        {isLoading ? "⏳" : "Send"}
                    </button>
                </div>

                {/* Request Config */}
                <div className="border-b border-gray-700">
                    <div className="flex border-b border-gray-700">
                        {(["params", "headers", "body"] as const).map(tab => (
                            <button
                                key={tab}
                                className={`px-4 py-2 text-sm capitalize ${activeTab === tab ? "bg-gray-800 text-blue-400" : "text-gray-400"}`}
                                onClick={() => setActiveTab(tab)}
                            >
                                {tab}
                                {tab === "headers" && ` (${request.headers.filter(h => h.enabled).length})`}
                            </button>
                        ))}
                    </div>

                    <div className="p-4 max-h-48 overflow-auto">
                        {activeTab === "headers" && (
                            <div className="space-y-2">
                                {request.headers.map((header, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={header.enabled}
                                            onChange={(e) => updateHeader(i, "enabled", e.target.checked)}
                                            className="w-4 h-4"
                                        />
                                        <input
                                            type="text"
                                            value={header.key}
                                            onChange={(e) => updateHeader(i, "key", e.target.value)}
                                            placeholder="Key"
                                            className="flex-1 px-2 py-1 bg-gray-800 rounded text-sm"
                                        />
                                        <input
                                            type="text"
                                            value={header.value}
                                            onChange={(e) => updateHeader(i, "value", e.target.value)}
                                            placeholder="Value"
                                            className="flex-1 px-2 py-1 bg-gray-800 rounded text-sm"
                                        />
                                        <button
                                            onClick={() => removeHeader(i)}
                                            className="text-red-400 hover:text-red-300 px-2"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={addHeader}
                                    className="text-sm text-blue-400 hover:text-blue-300"
                                >
                                    + Add Header
                                </button>
                            </div>
                        )}

                        {activeTab === "body" && (
                            <div>
                                <div className="flex gap-2 mb-2">
                                    {(["none", "json", "text", "form"] as const).map(type => (
                                        <button
                                            key={type}
                                            className={`px-3 py-1 rounded text-sm ${request.bodyType === type ? "bg-blue-600" : "bg-gray-700"}`}
                                            onClick={() => setRequest(r => ({ ...r, bodyType: type }))}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                                {request.bodyType !== "none" && (
                                    <textarea
                                        value={request.body}
                                        onChange={(e) => setRequest(r => ({ ...r, body: e.target.value }))}
                                        className="w-full h-24 px-3 py-2 bg-gray-800 rounded font-mono text-sm resize-none"
                                        placeholder="Request body"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Response */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {response ? (
                        <>
                            <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                                <div className="flex items-center gap-4">
                                    <span className={`font-bold ${response.status >= 200 && response.status < 300 ? "text-green-400" : "text-red-400"}`}>
                                        {response.status} {response.statusText}
                                    </span>
                                    <span className="text-gray-400 text-sm">{response.time}ms</span>
                                    <span className="text-gray-400 text-sm">{(response.size / 1024).toFixed(2)} KB</span>
                                </div>
                                <div className="flex gap-2">
                                    {(["body", "headers"] as const).map(tab => (
                                        <button
                                            key={tab}
                                            className={`px-3 py-1 rounded text-sm capitalize ${responseTab === tab ? "bg-blue-600" : "bg-gray-700"}`}
                                            onClick={() => setResponseTab(tab)}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto p-4">
                                {responseTab === "body" ? (
                                    <pre className="font-mono text-sm text-green-400 whitespace-pre-wrap">
                                        {formatResponseBody(response.body)}
                                    </pre>
                                ) : (
                                    <div className="space-y-1">
                                        {Object.entries(response.headers).map(([key, value]) => (
                                            <div key={key} className="text-sm">
                                                <span className="text-blue-400">{key}:</span>
                                                <span className="text-gray-300 ml-2">{value}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500">
                            Send a request to see the response
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatResponseBody(body: string): string {
    try {
        return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
        return body;
    }
}

export default ApiTester;
