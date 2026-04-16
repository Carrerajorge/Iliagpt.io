/**
 * OpenTelemetry metrics bootstrap.
 *
 * Uses dynamic import so that if any OTel package fails to load
 * (CJS/ESM interop, missing deps, etc.) the app still starts.
 */
async function initOtel() {
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const otelResources = await import("@opentelemetry/resources");
    const resourceFromAttributes = otelResources.resourceFromAttributes ?? (otelResources as any).default?.resourceFromAttributes;

    // semantic-conventions may have broken ESM; try CJS fallback
    let SemanticResourceAttributes: any;
    try {
      const semConv = await import("@opentelemetry/semantic-conventions");
      SemanticResourceAttributes = (semConv as any).SemanticResourceAttributes ?? (semConv as any).default?.SemanticResourceAttributes;
    } catch {
      try {
        const { createRequire } = await import("module");
        const _require = createRequire(import.meta.url);
        SemanticResourceAttributes = _require("@opentelemetry/semantic-conventions").SemanticResourceAttributes;
      } catch {
        // Fallback to inline constants
        SemanticResourceAttributes = {
          SERVICE_NAME: "service.name",
          SERVICE_VERSION: "service.version",
          DEPLOYMENT_ENVIRONMENT: "deployment.environment",
        };
      }
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector:4318";
    const serviceName = process.env.OTEL_SERVICE_NAME || "iliagpt-app";
    const serviceVersion = process.env.APP_VERSION || "dev";
    const environment = process.env.NODE_ENV || "development";

    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
    });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
      }),
      metricReader: new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 10000 }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    await sdk.start();
    console.log("[otel] started");

    process.on("SIGTERM", async () => {
      try { await sdk.shutdown(); } catch { /* ignore */ }
    });
  } catch (err) {
    console.error("[otel] failed to initialize — telemetry disabled:", err);
  }
}

initOtel();
