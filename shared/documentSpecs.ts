import { z } from "zod";

// -------------------------
// Excel (XLSX) specification
// -------------------------

// Header styling configuration
export const headerStyleSchema = z.object({
  bold: z.boolean().default(true),
  fill_color: z.string().nullable().optional().describe("Header background color hex, e.g. 'D9E1F2'"),
  text_align: z.enum(["left", "center", "right"]).default("center"),
  wrap_text: z.boolean().default(true),
});

export type HeaderStyle = z.infer<typeof headerStyleSchema>;

export const tableSpecSchema = z.object({
  name: z.string().nullable().optional().describe("Optional table name, auto-generated if not provided"),
  anchor: z.string().describe("Top-left cell, e.g. 'A1'"),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())).default([]),
  table_style: z.string().default("TableStyleMedium9").describe("Excel table style name (OpenXML)"),
  column_formats: z.record(z.string(), z.string()).default({}).describe("Map header -> Excel number format"),
  formulas: z.record(z.string(), z.string()).default({}).describe("Map header -> formula template with {row} placeholder, e.g. {'Total': '=B{row}*C{row}'}"),
  header_style: headerStyleSchema.default({}).describe("Styling for header row"),
  autofilter: z.boolean().default(true),
  freeze_header: z.boolean().default(true),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

export const chartSpecSchema = z.object({
  type: z.enum(["bar", "line", "pie"]).default("bar"),
  title: z.string().default(""),
  categories_range: z.string().describe("Excel A1 range for categories, e.g. 'A2:A10'"),
  values_range: z.string().describe("Excel A1 range for values, e.g. 'B2:B10'"),
  position: z.string().default("H2").describe("Top-left position of the chart"),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const sheetLayoutSpecSchema = z.object({
  freeze_panes: z.string().nullable().optional().describe("Cell reference for freeze panes, e.g. 'A2'"),
  auto_fit_columns: z.boolean().default(true),
  column_widths: z.record(z.string(), z.number()).default({}).describe("Map column letter -> width"),
  show_gridlines: z.boolean().default(true),
});

export type SheetLayoutSpec = z.infer<typeof sheetLayoutSpecSchema>;

export const sheetSpecSchema = z.object({
  name: z.string().min(1).max(31),
  tables: z.array(tableSpecSchema).default([]),
  charts: z.array(chartSpecSchema).default([]),
  layout: sheetLayoutSpecSchema.default({}),
});

export type SheetSpec = z.infer<typeof sheetSpecSchema>;

export const excelSpecSchema = z.object({
  workbook_title: z.string().default("Report"),
  sheets: z.array(sheetSpecSchema).min(1),
});

export type ExcelSpec = z.infer<typeof excelSpecSchema>;

// ------------------------
// Word (DOCX) specification
// ------------------------

// Title block (document title with Title style)
export const titleBlockSchema = z.object({
  type: z.literal("title"),
  text: z.string().min(1),
});

export type TitleBlock = z.infer<typeof titleBlockSchema>;

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6).default(1),
  text: z.string(),
});

export type HeadingBlock = z.infer<typeof headingBlockSchema>;

export const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
  style: z.string().nullable().optional().describe("Optional paragraph style name"),
});

export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;

export const bulletsBlockSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string()).min(1),
});

export type BulletsBlock = z.infer<typeof bulletsBlockSchema>;

// Numbered list block
export const numberedBlockSchema = z.object({
  type: z.literal("numbered"),
  items: z.array(z.string()).min(1),
});

export type NumberedBlock = z.infer<typeof numberedBlockSchema>;

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())).default([]),
  style: z.string().default("Table Grid").describe("Word table style name"),
  header: z.boolean().default(true).describe("Whether to show header row"),
});

export type TableBlock = z.infer<typeof tableBlockSchema>;

export const pageBreakBlockSchema = z.object({
  type: z.literal("page_break"),
});

export type PageBreakBlock = z.infer<typeof pageBreakBlockSchema>;

// Table of contents block
export const tocBlockSchema = z.object({
  type: z.literal("toc"),
  max_level: z.number().int().min(1).max(6).default(3).describe("Maximum heading level to include"),
});

export type TocBlock = z.infer<typeof tocBlockSchema>;

export const docBlockSchema = z.discriminatedUnion("type", [
  titleBlockSchema,
  headingBlockSchema,
  paragraphBlockSchema,
  bulletsBlockSchema,
  numberedBlockSchema,
  tableBlockSchema,
  pageBreakBlockSchema,
  tocBlockSchema,
]);

export type DocBlock = z.infer<typeof docBlockSchema>;

export const docSpecSchema = z.object({
  title: z.string().default("Document"),
  author: z.string().nullable().optional(),
  styleset: z.enum(["modern", "classic"]).default("modern").describe("Font style: modern=Calibri, classic=Times New Roman"),
  add_toc: z.boolean().default(false),
  blocks: z.array(docBlockSchema).default([]).describe("Ordered content blocks"),
});

export type DocSpec = z.infer<typeof docSpecSchema>;

// JSON Schema exports for LLM prompts
export const excelSpecJsonSchema = {
  type: "object",
  properties: {
    workbook_title: { type: "string", default: "Report" },
    sheets: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 31 },
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Optional table name" },
                anchor: { type: "string", description: "Top-left cell, e.g. 'A1'" },
                headers: { type: "array", items: { type: "string" }, minItems: 1 },
                rows: { type: "array", items: { type: "array" } },
                table_style: { type: "string", default: "TableStyleMedium9" },
                column_formats: { type: "object", additionalProperties: { type: "string" }, description: "Map header -> Excel number format" },
                formulas: { type: "object", additionalProperties: { type: "string" }, description: "Map header -> formula template with {row}, e.g. {'Total': '=B{row}*C{row}'}" },
                header_style: {
                  type: "object",
                  properties: {
                    bold: { type: "boolean", default: true },
                    fill_color: { type: "string", description: "Hex color e.g. 'D9E1F2'" },
                    text_align: { type: "string", enum: ["left", "center", "right"], default: "center" },
                    wrap_text: { type: "boolean", default: true },
                  },
                },
                autofilter: { type: "boolean", default: true },
                freeze_header: { type: "boolean", default: true },
              },
              required: ["anchor", "headers"],
            },
          },
          charts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["bar", "line", "pie"], default: "bar" },
                title: { type: "string" },
                categories_range: { type: "string" },
                values_range: { type: "string" },
                position: { type: "string", default: "H2" },
              },
              required: ["categories_range", "values_range"],
            },
          },
          layout: {
            type: "object",
            properties: {
              freeze_panes: { type: "string", nullable: true },
              auto_fit_columns: { type: "boolean", default: true },
              column_widths: { type: "object", additionalProperties: { type: "number" } },
              show_gridlines: { type: "boolean", default: true },
            },
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["sheets"],
};

export const docSpecJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", default: "Document" },
    author: { type: "string", nullable: true },
    styleset: { type: "string", enum: ["modern", "classic"], default: "modern", description: "Font style: modern=Calibri, classic=Times New Roman" },
    add_toc: { type: "boolean", default: false },
    blocks: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "title" },
              text: { type: "string" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "heading" },
              level: { type: "integer", minimum: 1, maximum: 6 },
              text: { type: "string" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "paragraph" },
              text: { type: "string" },
              style: { type: "string", description: "Optional paragraph style" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "bullets" },
              items: { type: "array", items: { type: "string" }, minItems: 1 },
            },
            required: ["type", "items"],
          },
          {
            type: "object",
            properties: {
              type: { const: "numbered" },
              items: { type: "array", items: { type: "string" }, minItems: 1 },
            },
            required: ["type", "items"],
          },
          {
            type: "object",
            properties: {
              type: { const: "table" },
              columns: { type: "array", items: { type: "string" }, minItems: 1 },
              rows: { type: "array", items: { type: "array" } },
              style: { type: "string", default: "Table Grid" },
              header: { type: "boolean", default: true },
            },
            required: ["type", "columns"],
          },
          {
            type: "object",
            properties: {
              type: { const: "page_break" },
            },
            required: ["type"],
          },
          {
            type: "object",
            properties: {
              type: { const: "toc" },
              max_level: { type: "integer", minimum: 1, maximum: 6, default: 3 },
            },
            required: ["type"],
          },
        ],
      },
    },
  },
  required: [],
};

// -------------------------
// CV/Resume specification
// -------------------------

export const cvHeaderSchema = z.object({
  name: z.string().min(1).describe("Full name"),
  phone: z.string().describe("Phone number"),
  email: z.string().email().describe("Email address"),
  address: z.string().describe("Physical address or city/country"),
  website: z.string().url().nullable().optional().describe("Personal website or portfolio URL"),
  photo_url: z.string().url().nullable().optional().describe("Profile photo URL"),
});

export type CvHeader = z.infer<typeof cvHeaderSchema>;

export const cvWorkExperienceSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  start_date: z.string().describe("Start date, e.g. 'Jan 2020' or '2020-01'"),
  end_date: z.string().nullable().optional().describe("End date or null/undefined for 'Present'"),
  location: z.string().nullable().optional().describe("City, Country"),
  description: z.string().nullable().optional().describe("Role description"),
  achievements: z.array(z.string()).default([]).describe("List of key achievements"),
});

export type CvWorkExperience = z.infer<typeof cvWorkExperienceSchema>;

export const cvEducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1).describe("e.g. 'Bachelor of Science'"),
  field: z.string().min(1).describe("e.g. 'Computer Science'"),
  start_date: z.string().describe("Start date"),
  end_date: z.string().nullable().optional().describe("End date or expected graduation"),
  gpa: z.string().nullable().optional().describe("GPA or grade, e.g. '3.8/4.0'"),
  achievements: z.array(z.string()).default([]).describe("Honors, awards, relevant coursework"),
});

export type CvEducation = z.infer<typeof cvEducationSchema>;

export const cvSkillSchema = z.object({
  name: z.string().min(1).describe("Skill name"),
  proficiency: z.number().int().min(1).max(5).describe("Proficiency level 1-5"),
});

export type CvSkill = z.infer<typeof cvSkillSchema>;

export const cvSkillCategorySchema = z.object({
  name: z.string().min(1).describe("Category name, e.g. 'Programming Languages'"),
  skills: z.array(cvSkillSchema).min(1),
});

export type CvSkillCategory = z.infer<typeof cvSkillCategorySchema>;

export const cvLanguageSchema = z.object({
  name: z.string().min(1).describe("Language name"),
  proficiency: z.number().int().min(1).max(5).describe("Proficiency level 1-5 (1=Basic, 5=Native)"),
});

export type CvLanguage = z.infer<typeof cvLanguageSchema>;

export const cvCertificationSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().min(1).describe("Issuing organization"),
  date: z.string().describe("Date obtained"),
  url: z.string().url().nullable().optional().describe("Verification URL"),
});

export type CvCertification = z.infer<typeof cvCertificationSchema>;

export const cvProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().describe("Project description"),
  technologies: z.array(z.string()).default([]).describe("Technologies used"),
  url: z.string().url().nullable().optional().describe("Project URL"),
});

export type CvProject = z.infer<typeof cvProjectSchema>;

export const cvColorSchemeSchema = z.object({
  primary: z.string().default("#1a1a1a").describe("Primary color hex"),
  accent: z.string().default("#2563eb").describe("Accent color hex"),
});

export type CvColorScheme = z.infer<typeof cvColorSchemeSchema>;

export const cvSpecSchema = z.object({
  header: cvHeaderSchema,
  profile_summary: z.string().nullable().optional().describe("Professional summary or objective"),
  work_experience: z.array(cvWorkExperienceSchema).default([]),
  education: z.array(cvEducationSchema).default([]),
  skills: z.array(cvSkillCategorySchema).default([]),
  languages: z.array(cvLanguageSchema).default([]),
  certifications: z.array(cvCertificationSchema).default([]),
  projects: z.array(cvProjectSchema).default([]),
  template_style: z.enum(["modern", "classic", "creative", "minimalist"]).default("modern"),
  color_scheme: cvColorSchemeSchema.default({}),
});

export type CvSpec = z.infer<typeof cvSpecSchema>;

// -------------------------
// Report specification
// -------------------------

export const reportHeaderSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  date: z.string().nullable().optional().describe("Report date"),
  organization: z.string().nullable().optional(),
  logo_url: z.string().url().nullable().optional().describe("Organization logo URL"),
});

export type ReportHeader = z.infer<typeof reportHeaderSchema>;

export const reportTextBlockSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
});

export const reportHeadingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(4).default(2),
  text: z.string(),
});

export const reportBulletsBlockSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string()).min(1),
});

export const reportNumberedBlockSchema = z.object({
  type: z.literal("numbered"),
  items: z.array(z.string()).min(1),
});

export const reportTableBlockSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())).default([]),
  caption: z.string().nullable().optional(),
});

export const reportImageBlockSchema = z.object({
  type: z.literal("image"),
  url: z.string().url(),
  alt: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  width: z.number().nullable().optional().describe("Width in pixels or percentage"),
});

export const reportChartBlockSchema = z.object({
  type: z.literal("chart"),
  chart_type: z.enum(["bar", "line", "pie", "area"]).default("bar"),
  title: z.string().nullable().optional(),
  data: z.object({
    labels: z.array(z.string()),
    values: z.array(z.number()),
  }),
});

export const reportQuoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: z.string(),
  attribution: z.string().nullable().optional(),
});

export const reportContentBlockSchema = z.discriminatedUnion("type", [
  reportTextBlockSchema,
  reportHeadingBlockSchema,
  reportBulletsBlockSchema,
  reportNumberedBlockSchema,
  reportTableBlockSchema,
  reportImageBlockSchema,
  reportChartBlockSchema,
  reportQuoteBlockSchema,
]);

export type ReportContentBlock = z.infer<typeof reportContentBlockSchema>;

export const reportSectionSchema = z.object({
  title: z.string().min(1),
  content: z.array(reportContentBlockSchema).default([]),
});

export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportSpecSchema = z.object({
  header: reportHeaderSchema,
  executive_summary: z.string().nullable().optional().describe("Executive summary paragraph"),
  sections: z.array(reportSectionSchema).default([]),
  show_toc: z.boolean().default(false).describe("Show table of contents"),
  show_page_numbers: z.boolean().default(true),
  template_style: z.enum(["corporate", "academic", "modern", "minimal"]).default("corporate"),
});

export type ReportSpec = z.infer<typeof reportSpecSchema>;

// -------------------------
// Letter specification
// -------------------------

export const letterSenderSchema = z.object({
  name: z.string().min(1),
  address: z.string().describe("Full address with line breaks or comma-separated"),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export type LetterSender = z.infer<typeof letterSenderSchema>;

export const letterRecipientSchema = z.object({
  name: z.string().min(1),
  title: z.string().nullable().optional().describe("Job title"),
  organization: z.string().nullable().optional(),
  address: z.string().describe("Full address"),
});

export type LetterRecipient = z.infer<typeof letterRecipientSchema>;

export const letterSpecSchema = z.object({
  sender: letterSenderSchema,
  recipient: letterRecipientSchema,
  date: z.string().describe("Letter date"),
  subject: z.string().nullable().optional().describe("Subject line (optional for some letter types)"),
  salutation: z.string().default("Dear").describe("Greeting, e.g. 'Dear Mr. Smith'"),
  body_paragraphs: z.array(z.string()).min(1).describe("Body paragraphs of the letter"),
  closing: z.string().default("Sincerely").describe("Closing phrase, e.g. 'Sincerely', 'Best regards'"),
  signature_name: z.string().describe("Name to appear in signature"),
  template_style: z.enum(["formal", "business", "personal", "modern"]).default("formal"),
});

export type LetterSpec = z.infer<typeof letterSpecSchema>;

// -------------------------
// JSON Schema exports for LLM prompts
// -------------------------

export const cvSpecJsonSchema = {
  type: "object",
  properties: {
    header: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name" },
        phone: { type: "string", description: "Phone number" },
        email: { type: "string", format: "email", description: "Email address" },
        address: { type: "string", description: "Physical address or city/country" },
        website: { type: "string", format: "uri", nullable: true, description: "Personal website or portfolio URL" },
        photo_url: { type: "string", format: "uri", nullable: true, description: "Profile photo URL" },
      },
      required: ["name", "phone", "email", "address"],
    },
    profile_summary: { type: "string", nullable: true, description: "Professional summary or objective" },
    work_experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          start_date: { type: "string", description: "e.g. 'Jan 2020'" },
          end_date: { type: "string", nullable: true, description: "End date or null for 'Present'" },
          location: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          achievements: { type: "array", items: { type: "string" } },
        },
        required: ["company", "role", "start_date"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string", nullable: true },
          gpa: { type: "string", nullable: true },
          achievements: { type: "array", items: { type: "string" } },
        },
        required: ["institution", "degree", "field", "start_date"],
      },
    },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Category name" },
          skills: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                proficiency: { type: "integer", minimum: 1, maximum: 5 },
              },
              required: ["name", "proficiency"],
            },
          },
        },
        required: ["name", "skills"],
      },
    },
    languages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          proficiency: { type: "integer", minimum: 1, maximum: 5, description: "1=Basic, 5=Native" },
        },
        required: ["name", "proficiency"],
      },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          date: { type: "string" },
          url: { type: "string", format: "uri", nullable: true },
        },
        required: ["name", "issuer", "date"],
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          technologies: { type: "array", items: { type: "string" } },
          url: { type: "string", format: "uri", nullable: true },
        },
        required: ["name", "description"],
      },
    },
    template_style: { type: "string", enum: ["modern", "classic", "creative", "minimalist"], default: "modern" },
    color_scheme: {
      type: "object",
      properties: {
        primary: { type: "string", default: "#1a1a1a", description: "Primary color hex" },
        accent: { type: "string", default: "#2563eb", description: "Accent color hex" },
      },
    },
  },
  required: ["header"],
};

export const reportSpecJsonSchema = {
  type: "object",
  properties: {
    header: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string", nullable: true },
        author: { type: "string", nullable: true },
        date: { type: "string", nullable: true },
        organization: { type: "string", nullable: true },
        logo_url: { type: "string", format: "uri", nullable: true },
      },
      required: ["title"],
    },
    executive_summary: { type: "string", nullable: true, description: "Executive summary paragraph" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: {
            type: "array",
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: { type: { const: "text" }, content: { type: "string" } },
                  required: ["type", "content"],
                },
                {
                  type: "object",
                  properties: { type: { const: "heading" }, level: { type: "integer", minimum: 1, maximum: 4 }, text: { type: "string" } },
                  required: ["type", "text"],
                },
                {
                  type: "object",
                  properties: { type: { const: "bullets" }, items: { type: "array", items: { type: "string" } } },
                  required: ["type", "items"],
                },
                {
                  type: "object",
                  properties: { type: { const: "numbered" }, items: { type: "array", items: { type: "string" } } },
                  required: ["type", "items"],
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "table" },
                    columns: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array" } },
                    caption: { type: "string", nullable: true },
                  },
                  required: ["type", "columns"],
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "image" },
                    url: { type: "string", format: "uri" },
                    alt: { type: "string", nullable: true },
                    caption: { type: "string", nullable: true },
                    width: { type: "number", nullable: true },
                  },
                  required: ["type", "url"],
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "chart" },
                    chart_type: { type: "string", enum: ["bar", "line", "pie", "area"] },
                    title: { type: "string", nullable: true },
                    data: {
                      type: "object",
                      properties: {
                        labels: { type: "array", items: { type: "string" } },
                        values: { type: "array", items: { type: "number" } },
                      },
                      required: ["labels", "values"],
                    },
                  },
                  required: ["type", "data"],
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "quote" },
                    text: { type: "string" },
                    attribution: { type: "string", nullable: true },
                  },
                  required: ["type", "text"],
                },
              ],
            },
          },
        },
        required: ["title"],
      },
    },
    show_toc: { type: "boolean", default: false, description: "Show table of contents" },
    show_page_numbers: { type: "boolean", default: true },
    template_style: { type: "string", enum: ["corporate", "academic", "modern", "minimal"], default: "corporate" },
  },
  required: ["header"],
};

export const letterSpecJsonSchema = {
  type: "object",
  properties: {
    sender: {
      type: "object",
      properties: {
        name: { type: "string" },
        address: { type: "string", description: "Full address" },
        phone: { type: "string", nullable: true },
        email: { type: "string", format: "email", nullable: true },
      },
      required: ["name", "address"],
    },
    recipient: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string", nullable: true, description: "Job title" },
        organization: { type: "string", nullable: true },
        address: { type: "string" },
      },
      required: ["name", "address"],
    },
    date: { type: "string", description: "Letter date" },
    subject: { type: "string", nullable: true, description: "Subject line" },
    salutation: { type: "string", default: "Dear", description: "Greeting" },
    body_paragraphs: { type: "array", items: { type: "string" }, minItems: 1, description: "Body paragraphs" },
    closing: { type: "string", default: "Sincerely", description: "Closing phrase" },
    signature_name: { type: "string", description: "Name in signature" },
    template_style: { type: "string", enum: ["formal", "business", "personal", "modern"], default: "formal" },
  },
  required: ["sender", "recipient", "date", "body_paragraphs", "signature_name"],
};
