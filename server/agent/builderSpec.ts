import { z } from "zod";
import { randomUUID } from "crypto";

// ============================================
// Position & Style Primitives
// ============================================

export const PositionSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().min(0),
  h: z.number().min(0),
  unit: z.enum(["percent", "px", "inches"]).optional(),
});
export type Position = z.infer<typeof PositionSchema>;

export const TextStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const BorderStyleSchema = z.object({
  width: z.number().min(0).optional(),
  color: z.string().optional(),
  style: z.enum(["solid", "dashed", "dotted", "double", "none"]).optional(),
});
export type BorderStyle = z.infer<typeof BorderStyleSchema>;

// ============================================
// 1. SlideSpec - PowerPoint/Presentation
// ============================================

export const SlideLayoutSchema = z.enum([
  "title",
  "section",
  "content",
  "two-column",
  "blank",
  "image",
  "comparison",
  "title-content",
]);
export type SlideLayout = z.infer<typeof SlideLayoutSchema>;

export const SlideElementTypeSchema = z.enum([
  "text",
  "image",
  "chart",
  "table",
  "shape",
  "video",
  "icon",
]);
export type SlideElementType = z.infer<typeof SlideElementTypeSchema>;

export const SlideElementStyleSchema = z.object({
  ...TextStyleSchema.shape,
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().optional(),
  shadow: z.object({
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    blur: z.number().optional(),
    color: z.string().optional(),
  }).optional(),
  border: BorderStyleSchema.optional(),
});
export type SlideElementStyle = z.infer<typeof SlideElementStyleSchema>;

export const SlideElementSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: SlideElementTypeSchema,
  content: z.union([z.string(), z.record(z.any())]).describe("Text content or structured data for charts/tables"),
  position: PositionSchema,
  style: SlideElementStyleSchema.optional(),
  alt: z.string().optional().describe("Alt text for accessibility"),
  link: z.string().url().optional().describe("Hyperlink URL"),
  zIndex: z.number().int().optional(),
});
export type SlideElement = z.infer<typeof SlideElementSchema>;

export const TransitionEffectSchema = z.object({
  type: z.enum([
    "none",
    "fade",
    "slide",
    "push",
    "wipe",
    "zoom",
    "dissolve",
    "cover",
    "uncover",
  ]).default("none"),
  duration: z.number().min(0).max(5000).default(500).describe("Duration in milliseconds"),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
});
export type TransitionEffect = z.infer<typeof TransitionEffectSchema>;

export const SlideSpecSchema = z.object({
  id: z.string().default(() => randomUUID()),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  layout: SlideLayoutSchema.default("content"),
  elements: z.array(SlideElementSchema).default([]),
  notes: z.string().max(5000).optional().describe("Speaker notes"),
  transition: TransitionEffectSchema.optional(),
  background: z.object({
    color: z.string().optional(),
    image: z.string().optional(),
    gradient: z.object({
      type: z.enum(["linear", "radial"]),
      colors: z.array(z.string()).min(2),
      angle: z.number().optional(),
    }).optional(),
  }).optional(),
  order: z.number().int().min(0).optional().describe("Slide order in deck"),
});
export type SlideSpec = z.infer<typeof SlideSpecSchema>;

export const PresentationSpecSchema = z.object({
  id: z.string().default(() => randomUUID()),
  title: z.string().min(1).max(200),
  author: z.string().optional(),
  theme: z.string().optional(),
  slides: z.array(SlideSpecSchema).min(1),
  metadata: z.object({
    createdAt: z.coerce.date().default(() => new Date()),
    updatedAt: z.coerce.date().optional(),
    version: z.string().default("1.0.0"),
    language: z.string().default("en"),
    tags: z.array(z.string()).optional(),
  }).optional(),
});
export type PresentationSpec = z.infer<typeof PresentationSpecSchema>;

// ============================================
// 2. DocSpec - Word Document
// ============================================

export const HeadingLevelSchema = z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]);
export type HeadingLevel = z.infer<typeof HeadingLevelSchema>;

export const ParagraphStyleSchema = z.enum([
  "normal",
  "quote",
  "code",
  "list-item",
  "caption",
  "footnote",
]);
export type ParagraphStyle = z.infer<typeof ParagraphStyleSchema>;

export const ParagraphSchema = z.object({
  id: z.string().default(() => randomUUID()),
  text: z.string(),
  style: ParagraphStyleSchema.default("normal"),
  formatting: TextStyleSchema.optional(),
  indent: z.number().min(0).optional(),
  lineSpacing: z.number().positive().optional(),
  listType: z.enum(["bullet", "numbered", "none"]).optional(),
  listLevel: z.number().int().min(0).max(9).optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const DocImageSchema = z.object({
  id: z.string().default(() => randomUUID()),
  src: z.string().describe("URL or base64 data"),
  alt: z.string().optional(),
  caption: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  alignment: z.enum(["left", "center", "right", "inline"]).default("center"),
});
export type DocImage = z.infer<typeof DocImageSchema>;

export const TableCellSchema = z.object({
  content: z.string(),
  rowSpan: z.number().int().min(1).default(1),
  colSpan: z.number().int().min(1).default(1),
  style: TextStyleSchema.optional(),
  backgroundColor: z.string().optional(),
});
export type TableCell = z.infer<typeof TableCellSchema>;

export const DocTableStyleSchema = z.enum([
  "default",
  "striped",
  "bordered",
  "minimal",
  "professional",
]);
export type DocTableStyle = z.infer<typeof DocTableStyleSchema>;

export const DocTableSchema = z.object({
  id: z.string().default(() => randomUUID()),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.union([z.string(), TableCellSchema]))),
  style: DocTableStyleSchema.default("default"),
  caption: z.string().optional(),
  columnWidths: z.array(z.number().positive()).optional(),
});
export type DocTable = z.infer<typeof DocTableSchema>;

export const DocSectionSchema = z.object({
  id: z.string().default(() => randomUUID()),
  heading: z.string().min(1).max(500),
  level: HeadingLevelSchema.default("h2"),
  paragraphs: z.array(ParagraphSchema).default([]),
  images: z.array(DocImageSchema).default([]),
  tables: z.array(DocTableSchema).default([]),
  subsections: z.lazy(() => z.array(DocSectionSchema)).optional(),
});
export type DocSection = z.infer<typeof DocSectionSchema>;

export const DocMetadataSchema = z.object({
  author: z.string().optional(),
  title: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  createdAt: z.coerce.date().default(() => new Date()),
  updatedAt: z.coerce.date().optional(),
  version: z.string().default("1.0.0"),
  language: z.string().default("en"),
  category: z.string().optional(),
  status: z.enum(["draft", "review", "final"]).default("draft"),
});
export type DocMetadata = z.infer<typeof DocMetadataSchema>;

export const DocSpecSchema = z.object({
  id: z.string().default(() => randomUUID()),
  title: z.string().min(1).max(500),
  sections: z.array(DocSectionSchema).min(1),
  metadata: DocMetadataSchema.optional(),
  header: z.object({
    text: z.string().optional(),
    showPageNumber: z.boolean().default(false),
  }).optional(),
  footer: z.object({
    text: z.string().optional(),
    showPageNumber: z.boolean().default(true),
  }).optional(),
  tableOfContents: z.boolean().default(false),
  pageSettings: z.object({
    size: z.enum(["letter", "a4", "legal"]).default("letter"),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    margins: z.object({
      top: z.number().min(0).default(1),
      bottom: z.number().min(0).default(1),
      left: z.number().min(0).default(1),
      right: z.number().min(0).default(1),
    }).optional(),
  }).optional(),
});
export type DocSpec = z.infer<typeof DocSpecSchema>;

// ============================================
// 3. SheetSpec - Excel Spreadsheet
// ============================================

export const CellAlignmentSchema = z.enum([
  "left",
  "center",
  "right",
  "top",
  "middle",
  "bottom",
]);
export type CellAlignment = z.infer<typeof CellAlignmentSchema>;

export const NumberFormatSchema = z.enum([
  "general",
  "number",
  "currency",
  "accounting",
  "date",
  "time",
  "percentage",
  "fraction",
  "scientific",
  "text",
  "custom",
]);
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

export const CellStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  horizontalAlignment: z.enum(["left", "center", "right"]).optional(),
  verticalAlignment: z.enum(["top", "middle", "bottom"]).optional(),
  wrapText: z.boolean().optional(),
  rotation: z.number().min(-90).max(90).optional(),
  border: z.object({
    top: BorderStyleSchema.optional(),
    bottom: BorderStyleSchema.optional(),
    left: BorderStyleSchema.optional(),
    right: BorderStyleSchema.optional(),
  }).optional(),
});
export type CellStyle = z.infer<typeof CellStyleSchema>;

export const CellSpecSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  formula: z.string().optional().describe("Excel formula starting with ="),
  format: NumberFormatSchema.optional(),
  formatPattern: z.string().optional().describe("Custom format pattern"),
  style: CellStyleSchema.optional(),
  comment: z.string().optional(),
  hyperlink: z.string().url().optional(),
  validation: z.object({
    type: z.enum(["list", "number", "date", "textLength", "custom"]),
    criteria: z.record(z.any()),
    errorMessage: z.string().optional(),
  }).optional(),
});
export type CellSpec = z.infer<typeof CellSpecSchema>;

export const MergedCellRangeSchema = z.object({
  startCell: z.string().describe("e.g., A1"),
  endCell: z.string().describe("e.g., C3"),
});
export type MergedCellRange = z.infer<typeof MergedCellRangeSchema>;

export const ChartTypeSchema = z.enum([
  "bar",
  "line",
  "pie",
  "doughnut",
  "area",
  "scatter",
  "bubble",
  "radar",
  "column",
  "combo",
  "treemap",
  "waterfall",
]);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const SheetChartSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: ChartTypeSchema,
  title: z.string().optional(),
  dataRange: z.string().describe("e.g., A1:D10"),
  position: PositionSchema,
  legend: z.object({
    show: z.boolean().default(true),
    position: z.enum(["top", "bottom", "left", "right"]).default("bottom"),
  }).optional(),
  axes: z.object({
    xTitle: z.string().optional(),
    yTitle: z.string().optional(),
    xMin: z.number().optional(),
    xMax: z.number().optional(),
    yMin: z.number().optional(),
    yMax: z.number().optional(),
  }).optional(),
  colors: z.array(z.string()).optional(),
});
export type SheetChart = z.infer<typeof SheetChartSchema>;

export const ConditionalFormatSchema = z.object({
  range: z.string().describe("e.g., A1:A100"),
  type: z.enum([
    "cellValue",
    "colorScale",
    "dataBar",
    "iconSet",
    "top10",
    "aboveAverage",
    "duplicateValues",
    "expression",
  ]),
  rule: z.record(z.any()),
  style: CellStyleSchema.optional(),
});
export type ConditionalFormat = z.infer<typeof ConditionalFormatSchema>;

export const WorksheetSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1).max(31).describe("Sheet tab name"),
  cells: z.record(z.string(), CellSpecSchema).default({}).describe("Cell address (e.g., A1) to CellSpec"),
  mergedCells: z.array(MergedCellRangeSchema).default([]),
  columnWidths: z.record(z.string(), z.number().positive()).optional().describe("Column letter to width"),
  rowHeights: z.record(z.string(), z.number().positive()).optional().describe("Row number to height"),
  frozenRows: z.number().int().min(0).optional(),
  frozenColumns: z.number().int().min(0).optional(),
  hidden: z.boolean().default(false),
  protected: z.boolean().default(false),
  tabColor: z.string().optional(),
});
export type Worksheet = z.infer<typeof WorksheetSchema>;

export const SheetSpecSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1).max(200),
  sheets: z.array(WorksheetSchema).min(1),
  charts: z.array(SheetChartSchema).default([]),
  conditionalFormats: z.array(ConditionalFormatSchema).default([]),
  namedRanges: z.record(z.string(), z.string()).optional().describe("Named range to cell range"),
  metadata: z.object({
    author: z.string().optional(),
    createdAt: z.coerce.date().default(() => new Date()),
    updatedAt: z.coerce.date().optional(),
    version: z.string().default("1.0.0"),
  }).optional(),
});
export type SheetSpec = z.infer<typeof SheetSpecSchema>;

// ============================================
// 4. AppSpec - Mini-App/Widget
// ============================================

export const AppTypeSchema = z.enum([
  "calculator",
  "form",
  "dashboard",
  "visualization",
  "wizard",
  "survey",
  "quiz",
  "configurator",
  "viewer",
  "custom",
]);
export type AppType = z.infer<typeof AppTypeSchema>;

export const ComponentTypeSchema = z.enum([
  "container",
  "text",
  "heading",
  "button",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "slider",
  "switch",
  "datepicker",
  "table",
  "chart",
  "image",
  "icon",
  "divider",
  "card",
  "tabs",
  "accordion",
  "modal",
  "alert",
  "progress",
  "list",
  "form",
  "grid",
  "flex",
]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

const BaseComponentSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: ComponentTypeSchema,
  props: z.record(z.any()).default({}),
  events: z.record(z.string(), z.string()).optional().describe("Event name to action name"),
  conditionalRender: z.object({
    field: z.string(),
    operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "contains", "exists"]),
    value: z.any(),
  }).optional(),
  style: z.record(z.any()).optional(),
});

export type Component = z.infer<typeof BaseComponentSchema> & {
  children?: (string | Component)[];
};

export const ComponentSchema: z.ZodType<Component> = BaseComponentSchema.extend({
  children: z.lazy(() => z.array(z.union([z.string(), ComponentSchema]))).optional(),
}) as any;

export const ActionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: z.enum([
    "setState",
    "submit",
    "navigate",
    "fetch",
    "calculate",
    "validate",
    "custom",
  ]),
  payload: z.record(z.any()).optional(),
  target: z.string().optional().describe("Target state field or URL"),
  condition: z.string().optional().describe("Condition expression"),
});
export type Action = z.infer<typeof ActionSchema>;

export const ValidationRuleSchema = z.object({
  field: z.string(),
  type: z.enum(["required", "email", "url", "number", "minLength", "maxLength", "pattern", "custom"]),
  value: z.any().optional(),
  message: z.string(),
});
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

export const AppSpecSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1).max(200),
  type: AppTypeSchema,
  description: z.string().optional(),
  components: z.array(ComponentSchema).min(1),
  state: z.record(z.any()).default({}).describe("Initial state object"),
  actions: z.array(ActionSchema).default([]),
  validations: z.array(ValidationRuleSchema).default([]),
  theme: z.object({
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    fontFamily: z.string().optional(),
    borderRadius: z.number().min(0).optional(),
  }).optional(),
  layout: z.object({
    type: z.enum(["fixed", "responsive", "fluid"]).default("responsive"),
    maxWidth: z.number().positive().optional(),
    padding: z.number().min(0).optional(),
  }).optional(),
  metadata: z.object({
    author: z.string().optional(),
    version: z.string().default("1.0.0"),
    createdAt: z.coerce.date().default(() => new Date()),
    updatedAt: z.coerce.date().optional(),
  }).optional(),
});
export type AppSpec = z.infer<typeof AppSpecSchema>;

// ============================================
// 5. ArtifactSpec - Union Type
// ============================================

export const ArtifactTypeSchema = z.enum([
  "presentation",
  "document",
  "spreadsheet",
  "app",
  "image",
  "code",
  "data",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("presentation"),
    spec: PresentationSpecSchema,
  }),
  z.object({
    type: z.literal("document"),
    spec: DocSpecSchema,
  }),
  z.object({
    type: z.literal("spreadsheet"),
    spec: SheetSpecSchema,
  }),
  z.object({
    type: z.literal("app"),
    spec: AppSpecSchema,
  }),
  z.object({
    type: z.literal("image"),
    spec: z.object({
      id: z.string().default(() => randomUUID()),
      prompt: z.string(),
      style: z.string().optional(),
      dimensions: z.object({
        width: z.number().positive(),
        height: z.number().positive(),
      }).optional(),
      format: z.enum(["png", "jpg", "svg", "webp"]).default("png"),
    }),
  }),
  z.object({
    type: z.literal("code"),
    spec: z.object({
      id: z.string().default(() => randomUUID()),
      language: z.string(),
      filename: z.string().optional(),
      content: z.string(),
      dependencies: z.array(z.string()).optional(),
      entryPoint: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("data"),
    spec: z.object({
      id: z.string().default(() => randomUUID()),
      format: z.enum(["json", "csv", "xml", "yaml"]),
      schema: z.record(z.any()).optional(),
      data: z.any(),
    }),
  }),
]);
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;

// ============================================
// 6. QualityGate - Validation Schema
// ============================================

export const FormatConstraintSchema = z.object({
  maxFileSize: z.number().positive().optional().describe("Max file size in bytes"),
  allowedFormats: z.array(z.string()).optional(),
  encoding: z.string().optional(),
  compression: z.boolean().optional(),
});
export type FormatConstraint = z.infer<typeof FormatConstraintSchema>;

export const QualityGateSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string(),
  targetType: ArtifactTypeSchema,

  minElements: z.number().int().min(0).optional(),
  maxElements: z.number().int().positive().optional(),

  requiredFields: z.array(z.string()).default([]),

  formatConstraints: FormatConstraintSchema.optional(),

  customRules: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    expression: z.string().describe("JSONPath or custom expression"),
    errorMessage: z.string(),
  })).default([]),

  severity: z.enum(["error", "warning", "info"]).default("error"),

  enabled: z.boolean().default(true),
});
export type QualityGate = z.infer<typeof QualityGateSchema>;

// ============================================
// Quality Gate Validation Functions
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; severity: string }>;
  warnings: Array<{ field: string; message: string }>;
}

export function validateArtifact(artifact: ArtifactSpec, gate: QualityGate): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!gate.enabled) {
    return result;
  }

  if (artifact.type !== gate.targetType && gate.targetType !== "data") {
    return result;
  }

  const spec = artifact.spec as Record<string, unknown>;

  for (const field of gate.requiredFields) {
    if (!(field in spec) || spec[field] === null || spec[field] === undefined) {
      result.errors.push({
        field,
        message: `Required field '${field}' is missing`,
        severity: gate.severity,
      });
      result.valid = false;
    }
  }

  if (gate.minElements !== undefined || gate.maxElements !== undefined) {
    let elementCount = 0;

    switch (artifact.type) {
      case "presentation":
        elementCount = (spec as PresentationSpec).slides?.length ?? 0;
        break;
      case "document":
        elementCount = (spec as DocSpec).sections?.length ?? 0;
        break;
      case "spreadsheet":
        elementCount = (spec as SheetSpec).sheets?.length ?? 0;
        break;
      case "app":
        elementCount = (spec as AppSpec).components?.length ?? 0;
        break;
    }

    if (gate.minElements !== undefined && elementCount < gate.minElements) {
      result.errors.push({
        field: "elements",
        message: `Minimum ${gate.minElements} elements required, found ${elementCount}`,
        severity: gate.severity,
      });
      result.valid = false;
    }

    if (gate.maxElements !== undefined && elementCount > gate.maxElements) {
      result.errors.push({
        field: "elements",
        message: `Maximum ${gate.maxElements} elements allowed, found ${elementCount}`,
        severity: gate.severity,
      });
      result.valid = false;
    }
  }

  return result;
}

// ============================================
// Default Quality Gates
// ============================================

export const DEFAULT_QUALITY_GATES: Record<ArtifactType, QualityGate> = {
  presentation: {
    id: "gate-presentation-default",
    name: "Default Presentation Quality Gate",
    targetType: "presentation",
    minElements: 1,
    maxElements: 100,
    requiredFields: ["title", "slides"],
    severity: "error",
    enabled: true,
    customRules: [],
  },
  document: {
    id: "gate-document-default",
    name: "Default Document Quality Gate",
    targetType: "document",
    minElements: 1,
    maxElements: 500,
    requiredFields: ["title", "sections"],
    severity: "error",
    enabled: true,
    customRules: [],
  },
  spreadsheet: {
    id: "gate-spreadsheet-default",
    name: "Default Spreadsheet Quality Gate",
    targetType: "spreadsheet",
    minElements: 1,
    maxElements: 50,
    requiredFields: ["name", "sheets"],
    formatConstraints: {
      maxFileSize: 50 * 1024 * 1024, // 50MB
    },
    severity: "error",
    enabled: true,
    customRules: [],
  },
  app: {
    id: "gate-app-default",
    name: "Default App Quality Gate",
    targetType: "app",
    minElements: 1,
    maxElements: 200,
    requiredFields: ["name", "type", "components"],
    severity: "error",
    enabled: true,
    customRules: [],
  },
  image: {
    id: "gate-image-default",
    name: "Default Image Quality Gate",
    targetType: "image",
    requiredFields: ["prompt"],
    formatConstraints: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedFormats: ["png", "jpg", "svg", "webp"],
    },
    severity: "error",
    enabled: true,
    customRules: [],
  },
  code: {
    id: "gate-code-default",
    name: "Default Code Quality Gate",
    targetType: "code",
    requiredFields: ["language", "content"],
    formatConstraints: {
      maxFileSize: 5 * 1024 * 1024, // 5MB
    },
    severity: "error",
    enabled: true,
    customRules: [],
  },
  data: {
    id: "gate-data-default",
    name: "Default Data Quality Gate",
    targetType: "data",
    requiredFields: ["format", "data"],
    formatConstraints: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedFormats: ["json", "csv", "xml", "yaml"],
    },
    severity: "error",
    enabled: true,
    customRules: [],
  },
};

// ============================================
// Factory Functions
// ============================================

export function createSlideSpec(params: Partial<SlideSpec> & { title: string }): SlideSpec {
  return SlideSpecSchema.parse({
    id: randomUUID(),
    layout: "content",
    elements: [],
    ...params,
  });
}

export function createDocSpec(params: Partial<DocSpec> & { title: string; sections: DocSection[] }): DocSpec {
  return DocSpecSchema.parse({
    id: randomUUID(),
    ...params,
  });
}

export function createSheetSpec(params: Partial<SheetSpec> & { name: string; sheets: Worksheet[] }): SheetSpec {
  return SheetSpecSchema.parse({
    id: randomUUID(),
    charts: [],
    conditionalFormats: [],
    ...params,
  });
}

export function createAppSpec(params: Partial<AppSpec> & {
  name: string;
  type: AppType;
  components: Component[]
}): AppSpec {
  return AppSpecSchema.parse({
    id: randomUUID(),
    state: {},
    actions: [],
    validations: [],
    ...params,
  });
}

export function createArtifact<T extends ArtifactType>(
  type: T,
  spec: T extends "presentation" ? PresentationSpec :
    T extends "document" ? DocSpec :
    T extends "spreadsheet" ? SheetSpec :
    T extends "app" ? AppSpec :
    Record<string, unknown>
): ArtifactSpec {
  return ArtifactSpecSchema.parse({ type, spec });
}

// ============================================
// Validation Helpers
// ============================================

export function validateSlideSpec(spec: unknown): SlideSpec {
  return SlideSpecSchema.parse(spec);
}

export function validateDocSpec(spec: unknown): DocSpec {
  return DocSpecSchema.parse(spec);
}

export function validateSheetSpec(spec: unknown): SheetSpec {
  return SheetSpecSchema.parse(spec);
}

export function validateAppSpec(spec: unknown): AppSpec {
  return AppSpecSchema.parse(spec);
}

export function validateArtifactSpec(spec: unknown): ArtifactSpec {
  return ArtifactSpecSchema.parse(spec);
}

export function validateQualityGate(gate: unknown): QualityGate {
  return QualityGateSchema.parse(gate);
}

// ============================================
// Utility / Mappers for Agent Executor
// ============================================

export function buildPresentationSpec(args: any, userId: string = "system"): PresentationSpec {
  const slideSpec = {
    title: args.title || "Untitled Presentation",
    theme: args.theme || "professional",
    slides: (args.slides || []).map((s: any, i: number) => ({
      id: `slide-${i + 1}`,
      layout: s.layout || "content",
      elements: [
        ...(s.title ? [{
          id: `title-${i}`,
          type: "text" as const,
          content: s.title,
          position: { x: 5, y: 5, w: 90, h: 15 },
          style: { fontSize: 32, bold: true, align: "center" as const }
        }] : []),
        ...(s.content ? [{
          id: `content-${i}`,
          type: "text" as const,
          content: s.content,
          position: { x: 5, y: 25, w: 90, h: 60 }
        }] : []),
        ...(s.bullets ? [{
          id: `bullets-${i}`,
          type: "list" as const,
          items: s.bullets,
          position: { x: 5, y: 25, w: 90, h: 60 }
        }] : [])
      ]
    })),
    metadata: { author: userId, createdAt: new Date() }
  };
  return PresentationSpecSchema.parse(slideSpec);
}

export function buildDocumentSpec(args: any, userId: string = "system"): DocSpec {
  const docSpec = {
    title: args.title || "Untitled Document",
    sections: (args.sections || []).map((s: any, i: number) => ({
      id: `section-${i + 1}`,
      heading: s.heading || `Section ${i + 1}`,
      level: s.level || 1,
      content: s.content ? [{ type: "paragraph" as const, text: s.content }] : [],
      bullets: s.bullets
    })),
    metadata: { author: userId, createdAt: new Date() }
  };
  return DocSpecSchema.parse(docSpec);
}

export function buildSpreadsheetSpec(args: any, userId: string = "system"): SheetSpec {
  const sheetSpec = {
    name: args.title || "Untitled Spreadsheet",
    sheets: (args.sheets || []).map((s: any, i: number) => {
      const cells: Record<string, CellSpec> = {};
      const headers = s.headers || [];
      headers.forEach((header: string, colIdx: number) => {
        const colLetter = String.fromCharCode(65 + colIdx);
        cells[`${colLetter}1`] = { value: header, style: { bold: true } };
      });
      const rows = s.rows || [];
      rows.forEach((row: any[], rowIdx: number) => {
        row.forEach((value: any, colIdx: number) => {
          const colLetter = String.fromCharCode(65 + colIdx);
          cells[`${colLetter}${rowIdx + 2}`] = { value };
        });
      });
      return {
        id: `sheet-${i + 1}`,
        name: s.name || `Sheet${i + 1}`,
        cells
      };
    }),
    metadata: { author: userId, createdAt: new Date() }
  };
  return SheetSpecSchema.parse(sheetSpec);
}
