import GatewayLogViewer from "@/components/admin/GatewayLogViewer";

export default function GatewayLogsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Gateway Logs
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Inspección en tiempo real de los logs del gateway OpenClaw con filtros por nivel,
            búsqueda textual, selección de archivo histórico y exportación filtrada.
          </p>
        </div>

        <GatewayLogViewer />
      </div>
    </div>
  );
}
