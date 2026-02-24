import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check, X, ExternalLink, Plug } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConnectorEntry {
  connectorId: string;
  displayName: string;
  category: string;
  authType: string;
  connected: boolean;
  capabilities: number;
}

interface ConnectorsResponse {
  connectors: ConnectorEntry[];
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

async function fetchConnectors(): Promise<ConnectorsResponse> {
  const res = await fetch("/api/connectors", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch connectors: ${res.status}`);
  return res.json();
}

async function disconnectConnector(connectorId: string): Promise<void> {
  const res = await fetch(`/api/connectors/oauth/${connectorId}/disconnect`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to disconnect: ${res.status}`);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        connected ? "bg-green-500" : "bg-gray-400"
      }`}
      title={connected ? "Connected" : "Not connected"}
    />
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colorMap: Record<string, string> = {
    productivity: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    communication: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    crm: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    storage: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    general: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  };
  const cls = colorMap[category] ?? colorMap.general;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {category}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
        </td>
      ))}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ConnectorCapabilityMatrix() {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ConnectorsResponse>({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    staleTime: 60_000,
    retry: 2,
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectConnector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  /* ---- Error state ---- */
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 dark:border-red-800 dark:bg-red-950">
        <X className="h-8 w-8 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-300">
          {(error as Error)?.message ?? "Failed to load connectors"}
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const connectors = data?.connectors ?? [];

  return (
    <div className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Connectors
          </h2>
          {!isLoading && (
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {connectors.length}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              <th className="px-4 py-2.5">Connector</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-center">Capabilities</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : connectors.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  No connectors available.
                </td>
              </tr>
            ) : (
              connectors.map((c) => (
                <tr
                  key={c.connectorId}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  {/* Name */}
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                    {c.displayName}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot connected={c.connected} />
                      <span
                        className={`text-xs ${
                          c.connected
                            ? "text-green-700 dark:text-green-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {c.connected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                  </td>

                  {/* Capabilities count */}
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      {c.capabilities}
                    </span>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3">
                    <CategoryBadge category={c.category} />
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {c.connected ? (
                      <button
                        onClick={() =>
                          disconnectMutation.mutate(c.connectorId)
                        }
                        disabled={disconnectMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Disconnect
                      </button>
                    ) : (
                      <a
                        href={`/api/connectors/oauth/${c.connectorId}/start`}
                        className="inline-flex items-center gap-1 rounded-md border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Connect
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      {!isLoading && connectors.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <Check className="mr-1 inline h-3 w-3 text-green-500" />
            {connectors.filter((c) => c.connected).length} of{" "}
            {connectors.length} connectors active &middot;{" "}
            {connectors.reduce((sum, c) => sum + c.capabilities, 0)} total
            capabilities
          </p>
        </div>
      )}
    </div>
  );
}
