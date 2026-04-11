import { createMultiSheetExcel } from "../../../services/advancedExcelBuilder.ts";
import type { StructuredData } from "../../../services/skillHandlers/professionalFileGenerator.ts";

interface SeedWorkbook {
  buffer: Buffer;
  fileName: string;
}

type SeedScenario =
  | "financial_projection"
  | "sales_dashboard"
  | "retention_cohorts"
  | "commercial_funnel"
  | "costs_margins"
  | "inventory_demand"
  | "operational_schedule"
  | "default";

function normalizeObjective(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferScenario(objective: string): SeedScenario {
  const normalized = normalizeObjective(objective);
  if (normalized.includes("proyeccion financiera")) return "financial_projection";
  if (normalized.includes("dashboard de ventas") || normalized.includes("ventas por region")) return "sales_dashboard";
  if (normalized.includes("cohort")) return "retention_cohorts";
  if (normalized.includes("funnel")) return "commercial_funnel";
  if (normalized.includes("costos y margenes") || normalized.includes("margenes")) return "costs_margins";
  if (normalized.includes("inventario") || normalized.includes("demanda")) return "inventory_demand";
  if (normalized.includes("cronograma operativo") || normalized.includes("capacidad semanal")) return "operational_schedule";
  return "default";
}

function inferTitle(objective: string, fallback: string): string {
  const cleaned = String(objective || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(crea|genera|haz|arma)\s+/i, "")
    .replace(/^(un|una)\s+/i, "")
    .slice(0, 96);

  return cleaned || fallback;
}

function sanitizeBaseName(value: string): string {
  const cleaned = String(value || "workbook")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return cleaned || "workbook";
}

function buildFinancialProjectionWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Proyeccion",
        headers: ["Trimestre", "Nuevos clientes", "Clientes activos", "MRR USD", "Ingresos USD", "CAC USD", "Margen EBITDA %"],
        rows: [
          ["2026-Q1", 42, 180, 18500, 55500, 420, 0.18],
          ["2026-Q2", 57, 224, 23900, 71700, 405, 0.22],
          ["2026-Q3", 71, 281, 30600, 91800, 392, 0.25],
          ["2026-Q4", 88, 352, 38900, 116700, 380, 0.28],
          ["2027-Q1", 96, 430, 47100, 141300, 368, 0.31],
          ["2027-Q2", 108, 521, 56800, 170400, 360, 0.33],
        ],
      },
      {
        name: "Supuestos",
        headers: ["Variable", "Valor", "Unidad", "Comentario"],
        rows: [
          ["ARPA", 308, "USD/mes", "Ticket promedio por cuenta activa"],
          ["Churn mensual", 0.024, "%", "Rotacion media observada"],
          ["Crecimiento pipeline", 0.17, "%", "Expansion trimestral del embudo"],
          ["Gasto comercial", 18500, "USD", "Inversion base por trimestre"],
          ["Ciclo de venta", 47, "dias", "Promedio mid-market"],
        ],
      },
    ],
  };
}

function buildSalesDashboardWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Ventas",
        headers: ["Region", "Canal", "Ventas USD", "Pedidos", "Ticket medio USD", "Margen %"],
        rows: [
          ["Norte", "Directo", 182000, 640, 284, 0.36],
          ["Norte", "Partners", 121000, 430, 281, 0.31],
          ["Centro", "Directo", 214000, 710, 301, 0.38],
          ["Centro", "Ecommerce", 167000, 920, 182, 0.29],
          ["Sur", "Retail", 144000, 810, 178, 0.25],
          ["Sur", "Directo", 109000, 360, 303, 0.34],
        ],
      },
      {
        name: "KPI",
        headers: ["Indicador", "Valor", "Meta", "Desvio"],
        rows: [
          ["Revenue total", 937000, 900000, 37000],
          ["Margen promedio", 0.322, 0.300, 0.022],
          ["Ticket medio", 242, 230, 12],
          ["Pedidos", 3870, 3600, 270],
        ],
      },
    ],
  };
}

function buildRetentionWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Cohortes",
        headers: ["Cohorte", "M0", "M1", "M2", "M3", "M4", "M5"],
        rows: [
          ["2026-01", 100, 82, 74, 69, 63, 59],
          ["2026-02", 100, 79, 71, 65, 61, 56],
          ["2026-03", 100, 84, 76, 71, 66, 61],
          ["2026-04", 100, 86, 78, 73, 68, 64],
          ["2026-05", 100, 88, 80, 75, 70, 66],
        ],
      },
      {
        name: "Resumen",
        headers: ["Indicador", "Valor"],
        rows: [
          ["Retencion M1", 0.838],
          ["Retencion M3", 0.706],
          ["Retencion M5", 0.612],
          ["Expansion neta", 0.124],
        ],
      },
    ],
  };
}

function buildFunnelWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Funnel",
        headers: ["Etapa", "Volumen", "Conversion %", "Dias en etapa", "Valor pipeline USD"],
        rows: [
          ["Lead", 1850, 1, 0, 925000],
          ["MQL", 920, 0.497, 5, 690000],
          ["SQL", 510, 0.554, 8, 510000],
          ["Propuesta", 205, 0.402, 12, 307500],
          ["Negociacion", 94, 0.459, 16, 188000],
          ["Cierre", 48, 0.511, 6, 144000],
        ],
      },
      {
        name: "Conversion",
        headers: ["Segmento", "Lead a SQL", "SQL a Cierre", "Win rate", "CAC USD"],
        rows: [
          ["SMB", 0.22, 0.11, 0.08, 280],
          ["Mid-market", 0.31, 0.18, 0.12, 460],
          ["Enterprise", 0.27, 0.24, 0.15, 920],
        ],
      },
    ],
  };
}

function buildCostsWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Portafolio",
        headers: ["SKU", "Linea", "Precio neto USD", "Costo unitario USD", "Margen bruto USD", "Margen bruto %"],
        rows: [
          ["IND-101", "Automatizacion", 1280, 790, 490, 0.383],
          ["IND-204", "Sensores", 860, 470, 390, 0.453],
          ["IND-310", "Control", 1540, 990, 550, 0.357],
          ["IND-415", "Servicios", 690, 240, 450, 0.652],
          ["IND-502", "Mantenimiento", 980, 410, 570, 0.582],
        ],
      },
      {
        name: "Drivers",
        headers: ["Driver", "Peso %", "Variacion trimestral %", "Mitigacion"],
        rows: [
          ["Materia prima", 0.41, 0.06, "Compras anticipadas"],
          ["Logistica", 0.18, 0.04, "Consolidacion de rutas"],
          ["Mano de obra", 0.23, 0.03, "Mejora de productividad"],
          ["Energia", 0.08, 0.07, "Contrato indexado"],
          ["Garantias", 0.10, -0.01, "Calidad preventiva"],
        ],
      },
    ],
  };
}

function buildInventoryWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Inventario",
        headers: ["SKU", "Categoria", "Stock actual", "Safety stock", "Lead time dias", "Cobertura semanas"],
        rows: [
          ["SUP-001", "Lacteos", 1420, 900, 4, 2.3],
          ["SUP-015", "Bebidas", 2250, 1500, 6, 2.8],
          ["SUP-031", "Snacks", 1880, 1100, 8, 2.1],
          ["SUP-044", "Limpieza", 980, 650, 10, 1.7],
          ["SUP-078", "Congelados", 760, 540, 5, 1.9],
        ],
      },
      {
        name: "Demanda",
        headers: ["Semana", "Demanda esperada", "Demanda pico", "Reposicion planificada", "Riesgo"],
        rows: [
          ["2026-W15", 1320, 1480, 1400, "Medio"],
          ["2026-W16", 1390, 1560, 1500, "Medio"],
          ["2026-W17", 1455, 1660, 1580, "Alto"],
          ["2026-W18", 1510, 1725, 1650, "Alto"],
          ["2026-W19", 1490, 1690, 1600, "Medio"],
        ],
      },
    ],
  };
}

function buildOperationsWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Cronograma",
        headers: ["Semana", "Linea", "Turnos", "Horas planificadas", "Horas disponibles", "Utilizacion %"],
        rows: [
          ["2026-W15", "Linea A", 2, 84, 96, 0.875],
          ["2026-W15", "Linea B", 3, 118, 120, 0.983],
          ["2026-W16", "Linea A", 2, 88, 96, 0.917],
          ["2026-W16", "Linea B", 3, 120, 120, 1],
          ["2026-W17", "Linea A", 3, 112, 120, 0.933],
          ["2026-W17", "Linea B", 3, 117, 120, 0.975],
        ],
      },
      {
        name: "Capacidad",
        headers: ["Centro", "Capacidad nominal", "Backlog", "OEE %", "Accion"],
        rows: [
          ["Corte", 540, 72, 0.86, "Mantener"],
          ["Ensamble", 620, 105, 0.82, "Refuerzo eventual"],
          ["Pintura", 410, 38, 0.88, "Mantener"],
          ["Despacho", 380, 54, 0.79, "Redistribuir turnos"],
        ],
      },
    ],
  };
}

function buildDefaultWorkbook(title: string): StructuredData {
  return {
    title,
    theme: "professional",
    sheets: [
      {
        name: "Resumen",
        headers: ["Bloque", "Hallazgo", "Prioridad", "Impacto esperado"],
        rows: [
          ["Mercado", "Demanda con crecimiento sostenido en segmentos premium", "Alta", "Expandir cobertura comercial"],
          ["Competencia", "Alta fragmentacion con espacio para propuesta diferenciada", "Alta", "Mejorar posicionamiento"],
          ["Finanzas", "Escenario base con margen saludable y CAC controlado", "Media", "Escalar de forma gradual"],
          ["Operacion", "Capacidad suficiente para crecimiento de corto plazo", "Media", "Activar optimizaciones"],
        ],
      },
      {
        name: "Detalle",
        headers: ["Indicador", "Valor", "Unidad", "Nota"],
        rows: [
          ["TAM estimado", 185000000, "USD", "Mercado objetivo anual"],
          ["Crecimiento categoria", 0.14, "%", "Promedio regional"],
          ["Participacion objetivo", 0.035, "%", "Meta a 24 meses"],
          ["Payback CAC", 7.8, "meses", "Escenario conservador"],
        ],
      },
    ],
  };
}

function buildWorkbookData(objective: string): StructuredData {
  const scenario = inferScenario(objective);
  const title = inferTitle(objective, "Workbook profesional");

  switch (scenario) {
    case "financial_projection":
      return buildFinancialProjectionWorkbook(title);
    case "sales_dashboard":
      return buildSalesDashboardWorkbook(title);
    case "retention_cohorts":
      return buildRetentionWorkbook(title);
    case "commercial_funnel":
      return buildFunnelWorkbook(title);
    case "costs_margins":
      return buildCostsWorkbook(title);
    case "inventory_demand":
      return buildInventoryWorkbook(title);
    case "operational_schedule":
      return buildOperationsWorkbook(title);
    default:
      return buildDefaultWorkbook(title);
  }
}

export async function buildSeedXlsxFromObjective(objective: string): Promise<SeedWorkbook> {
  const data = buildWorkbookData(objective);
  const result = await createMultiSheetExcel(
    data.sheets.map((sheet) => ({
      name: sheet.name,
      data: [sheet.headers, ...sheet.rows],
      options: {
        autoFormulas: sheet.formulas !== false,
        autoColumnWidth: true,
        freezeHeader: true,
      },
    })),
    {
      title: data.title,
      theme: data.theme || "professional",
      includeSummary: true,
    },
  );

  return {
    buffer: result.buffer,
    fileName: result.filename || `${sanitizeBaseName(data.title)}.xlsx`,
  };
}
