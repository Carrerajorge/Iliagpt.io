import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  AlignmentType,
  ExternalHyperlink,
  ImageRun,
  VerticalAlign,
  ShadingType,
  TabStopPosition,
  TabStopType,
} from "docx";
import { parseAndRenderToDocx, hasRichTextMarkers } from "./richText";
// ============================================
// SECURITY
// ============================================

/** Allowed URL protocols for hyperlinks */
const ALLOWED_URL_PROTOCOLS = ["http:", "https:", "mailto:"];

/** Maximum items per section */
const MAX_SECTION_ITEMS = 200;

/** Maximum text length per field */
const MAX_FIELD_TEXT_LENGTH = 50_000;

function isAllowedUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return ALLOWED_URL_PROTOCOLS.some(proto => trimmed.startsWith(proto));
}

/** Validate hex color - must be 6-char hex (no #) */
function isValidHexColor(color: string): boolean {
  return /^[0-9A-Fa-f]{3,8}$/.test(color);
}

import {
  CvSpec,
  CvHeader,
  CvWorkExperience,
  CvEducation,
  CvSkillCategory,
  CvLanguage,
  CvCertification,
  CvProject,
} from "../../shared/documentSpecs";
import { CvTemplateConfig, getCvTemplate } from "./documentTemplates";
import { formatDateRange, generateSkillDots, generateSkillBar, generateSkillPercentage, generateSkillTags } from "./documentMappingService";

interface InternalRenderConfig {
  layout: "single-column" | "two-column" | "sidebar";
  showPhoto: boolean;
  photoShape: "circle" | "square" | "rounded";
  skillStyle: "dots" | "bars" | "tags" | "percentage" | "text";
  accentColor: string;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  lightTextColor: string;
  backgroundColor: string;
  sidebarBgColor: string;
  headingFont: string;
  bodyFont: string;
  accentFont: string;
  nameSize: number;
  headingSize: number;
  sectionHeadingSize: number;
  bodySize: number;
  smallSize: number;
  sectionGap: number;
  itemGap: number;
  lineHeight: number;
  sidebarWidth: number;
  twoColumnLeftWidth: number;
  twoColumnRightWidth: number;
  emptyIndicatorColor: string;
}

function hexToRgb(hex: string): string {
  return hex.replace("#", "");
}

function renderRichText(
  text: string,
  config: InternalRenderConfig,
  options?: { color?: string; extraBold?: boolean }
): (TextRun | ExternalHyperlink)[] {
  const fontConfig = { font: config.bodyFont, size: config.bodySize };
  const color = options?.color || config.textColor;

  if (hasRichTextMarkers(text)) {
    return parseAndRenderToDocx(text, fontConfig, {
      extraBold: options?.extraBold,
      defaultColor: color,
    });
  }

  return [
    new TextRun({
      text,
      font: config.bodyFont,
      size: config.bodySize,
      color,
      bold: options?.extraBold,
    }),
  ];
}

function templateConfigToInternal(templateConfig: CvTemplateConfig, spec?: CvSpec): InternalRenderConfig {
  const baseBodySize = 22;
  
  let config: InternalRenderConfig = {
    layout: templateConfig.layout,
    showPhoto: templateConfig.showPhoto,
    photoShape: templateConfig.photoShape,
    skillStyle: templateConfig.skillStyle,
    accentColor: hexToRgb(templateConfig.colors.accent),
    primaryColor: hexToRgb(templateConfig.colors.primary),
    secondaryColor: hexToRgb(templateConfig.colors.secondary),
    textColor: hexToRgb(templateConfig.colors.text),
    lightTextColor: hexToRgb(templateConfig.colors.lightText),
    backgroundColor: hexToRgb(templateConfig.colors.background),
    sidebarBgColor: hexToRgb(templateConfig.colors.sidebarBg || templateConfig.colors.primary),
    headingFont: templateConfig.fonts.heading,
    bodyFont: templateConfig.fonts.body,
    accentFont: templateConfig.fonts.accent,
    nameSize: Math.round(baseBodySize * 2.5),
    headingSize: Math.round(baseBodySize * 1.5),
    sectionHeadingSize: Math.round(baseBodySize * 1.1),
    bodySize: baseBodySize,
    smallSize: baseBodySize - 2,
    sectionGap: Math.round(templateConfig.spacing.sectionGap * 10),
    itemGap: Math.round(templateConfig.spacing.itemGap * 5),
    lineHeight: Math.round(templateConfig.spacing.lineHeight * 240),
    sidebarWidth: templateConfig.sidebarWidth || 30,
    twoColumnLeftWidth: templateConfig.twoColumnLeftWidth || 65,
    twoColumnRightWidth: templateConfig.twoColumnRightWidth || 35,
    emptyIndicatorColor: hexToRgb(templateConfig.colors.lightText),
  };

  if (spec?.color_scheme) {
    if (spec.color_scheme.accent) {
      config.accentColor = hexToRgb(spec.color_scheme.accent);
    }
    if (spec.color_scheme.primary) {
      config.primaryColor = hexToRgb(spec.color_scheme.primary);
    }
    if (spec.color_scheme.text) {
      config.textColor = hexToRgb(spec.color_scheme.text);
    }
    if (spec.color_scheme.background) {
      config.backgroundColor = hexToRgb(spec.color_scheme.background);
    }
  }

  return config;
}

function createSectionHeading(text: string, config: InternalRenderConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: config.headingFont,
        size: config.sectionHeadingSize,
        bold: true,
        color: config.accentColor,
      }),
    ],
    spacing: { before: config.sectionGap, after: config.itemGap },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 12,
        color: config.accentColor,
      },
    },
  });
}

function createSidebarSectionHeading(text: string, config: InternalRenderConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: config.headingFont,
        size: config.sectionHeadingSize - 4,
        bold: true,
        color: config.backgroundColor,
      }),
    ],
    spacing: { before: config.sectionGap / 2, after: config.itemGap },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 8,
        color: config.backgroundColor,
      },
    },
  });
}

function createPhotoPlaceholder(config: InternalRenderConfig, forSidebar: boolean = false): Paragraph {
  const textColor = forSidebar ? config.backgroundColor : config.accentColor;
  const borderColor = forSidebar ? config.backgroundColor : config.accentColor;
  const fontSize = forSidebar ? config.headingSize : config.nameSize;
  
  let shapeIndicator: string;
  switch (config.photoShape) {
    case "circle":
      shapeIndicator = "◯";
      break;
    case "rounded":
      shapeIndicator = "▢";
      break;
    case "square":
    default:
      shapeIndicator = "□";
      break;
  }
  
  return new Paragraph({
    children: [
      new TextRun({
        text: shapeIndicator,
        font: config.bodyFont,
        size: fontSize * 2,
        color: textColor,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: config.itemGap },
  });
}

function createHeaderSection(header: CvHeader, config: InternalRenderConfig): (Paragraph | Table)[] {
  const showPhoto = config.showPhoto && header.photo_url;
  
  const nameParagraph = new Paragraph({
    children: [
      new TextRun({
        text: header.name,
        font: config.headingFont,
        size: config.nameSize,
        bold: true,
        color: config.accentColor,
      }),
    ],
    alignment: showPhoto ? AlignmentType.LEFT : AlignmentType.CENTER,
    spacing: { after: config.itemGap },
  });
  
  const contactParts: string[] = [];
  if (header.phone) contactParts.push(header.phone);
  if (header.email) contactParts.push(header.email);
  if (header.address) contactParts.push(header.address);
  
  const contactChildren: (TextRun | ExternalHyperlink)[] = [];
  
  contactParts.forEach((part, index) => {
    if (index > 0) {
      contactChildren.push(
        new TextRun({
          text: "  |  ",
          font: config.bodyFont,
          size: config.bodySize,
          color: config.lightTextColor,
        })
      );
    }
    contactChildren.push(
      new TextRun({
        text: part,
        font: config.bodyFont,
        size: config.bodySize,
        color: config.textColor,
      })
    );
  });
  
  if (header.website && isAllowedUrl(header.website)) {
    if (contactParts.length > 0) {
      contactChildren.push(
        new TextRun({
          text: "  |  ",
          font: config.bodyFont,
          size: config.bodySize,
          color: config.lightTextColor,
        })
      );
    }
    contactChildren.push(
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: header.website.replace(/^https?:\/\//, ""),
            font: config.bodyFont,
            size: config.bodySize,
            color: config.accentColor,
            underline: {},
          }),
        ],
        link: header.website,
      })
    );
  }
  
  const contactParagraph = new Paragraph({
    children: contactChildren,
    alignment: showPhoto ? AlignmentType.LEFT : AlignmentType.CENTER,
    spacing: { after: config.sectionGap / 2 },
  });
  
  if (showPhoto) {
    const noBorder = {
      style: BorderStyle.NONE,
      size: 0,
      color: config.backgroundColor,
    };
    
    const headerTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [nameParagraph, contactParagraph],
              width: { size: 75, type: WidthType.PERCENTAGE },
              borders: {
                top: noBorder,
                bottom: noBorder,
                left: noBorder,
                right: noBorder,
              },
              verticalAlign: VerticalAlign.CENTER,
            }),
            new TableCell({
              children: [createPhotoPlaceholder(config, false)],
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: {
                top: noBorder,
                bottom: noBorder,
                left: noBorder,
                right: noBorder,
              },
              verticalAlign: VerticalAlign.CENTER,
            }),
          ],
        }),
      ],
    });
    
    return [headerTable];
  }
  
  return [nameParagraph, contactParagraph];
}

function createProfileSummary(summary: string, config: InternalRenderConfig): Paragraph[] {
  return [
    createSectionHeading("Profile", config),
    new Paragraph({
      children: renderRichText(summary, config, { color: config.lightTextColor }),
      spacing: { after: config.sectionGap / 2, line: config.lineHeight },
    }),
  ];
}

function createWorkExperienceSection(experiences: CvWorkExperience[], config: InternalRenderConfig): (Paragraph | Table)[] {
  if (experiences.length === 0) return [];
  
  const elements: (Paragraph | Table)[] = [createSectionHeading("Work Experience", config)];
  
  for (const exp of experiences) {
    const headerChildren: TextRun[] = [
      new TextRun({
        text: exp.company,
        font: config.bodyFont,
        size: config.bodySize,
        bold: true,
        color: config.textColor,
      }),
    ];
    
    if (exp.location) {
      headerChildren.push(
        new TextRun({
          text: `  •  ${exp.location}`,
          font: config.bodyFont,
          size: config.smallSize,
          color: config.lightTextColor,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: headerChildren,
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { before: config.itemGap * 2, after: config.itemGap / 2 },
      })
    );
    
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: exp.role,
            font: config.bodyFont,
            size: config.bodySize,
            italics: true,
            color: config.textColor,
          }),
          new TextRun({
            text: "\t",
          }),
          new TextRun({
            text: formatDateRange(exp.start_date, exp.end_date),
            font: config.bodyFont,
            size: config.smallSize,
            color: config.lightTextColor,
          }),
        ],
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { after: config.itemGap },
      })
    );
    
    if (exp.description) {
      elements.push(
        new Paragraph({
          children: renderRichText(exp.description, config, { color: config.lightTextColor }),
          spacing: { after: config.itemGap, line: config.lineHeight },
        })
      );
    }
    
    for (const achievement of exp.achievements || []) {
      elements.push(
        new Paragraph({
          children: renderRichText(achievement, config),
          bullet: { level: 0 },
          spacing: { after: config.itemGap / 2 },
        })
      );
    }
  }
  
  return elements;
}

function createEducationSection(education: CvEducation[], config: InternalRenderConfig): Paragraph[] {
  if (education.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Education", config)];
  
  for (const edu of education) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: edu.institution,
            font: config.bodyFont,
            size: config.bodySize,
            bold: true,
            color: config.textColor,
          }),
          new TextRun({
            text: "\t",
          }),
          new TextRun({
            text: formatDateRange(edu.start_date, edu.end_date),
            font: config.bodyFont,
            size: config.smallSize,
            color: config.lightTextColor,
          }),
        ],
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        spacing: { before: config.itemGap * 2, after: config.itemGap / 2 },
      })
    );
    
    const degreeText = `${edu.degree} in ${edu.field}`;
    const degreeChildren: TextRun[] = [
      new TextRun({
        text: degreeText,
        font: config.bodyFont,
        size: config.bodySize,
        italics: true,
        color: config.textColor,
      }),
    ];
    
    if (edu.gpa) {
      degreeChildren.push(
        new TextRun({
          text: `  •  GPA: ${edu.gpa}`,
          font: config.bodyFont,
          size: config.smallSize,
          color: config.lightTextColor,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: degreeChildren,
        spacing: { after: config.itemGap },
      })
    );
    
    for (const achievement of edu.achievements || []) {
      elements.push(
        new Paragraph({
          children: renderRichText(achievement, config),
          bullet: { level: 0 },
          spacing: { after: config.itemGap / 2 },
        })
      );
    }
  }
  
  return elements;
}

function createProficiencyVisual(proficiency: number, style: InternalRenderConfig["skillStyle"], config: InternalRenderConfig, forSidebar: boolean = false): TextRun[] {
  const maxLevel = 5;
  const textColor = forSidebar ? config.backgroundColor : config.accentColor;
  const emptyColor = forSidebar ? config.secondaryColor : config.emptyIndicatorColor;
  const fontSize = forSidebar ? config.smallSize - 2 : config.smallSize;
  
  switch (style) {
    case "dots": {
      const dotsStr = generateSkillDots(proficiency, maxLevel);
      const filledCount = Math.min(Math.max(0, Math.round(proficiency)), maxLevel);
      const filled = "●".repeat(filledCount);
      const empty = "○".repeat(maxLevel - filledCount);
      return [
        new TextRun({
          text: filled,
          font: config.bodyFont,
          size: fontSize,
          color: textColor,
        }),
        new TextRun({
          text: empty,
          font: config.bodyFont,
          size: fontSize,
          color: emptyColor,
        }),
      ];
    }
    
    case "bars": {
      const barInfo = generateSkillBar(proficiency, maxLevel);
      const filled = "█".repeat(barInfo.filled);
      const empty = "░".repeat(barInfo.empty);
      return [
        new TextRun({
          text: filled,
          font: config.accentFont,
          size: fontSize,
          color: textColor,
        }),
        new TextRun({
          text: empty,
          font: config.accentFont,
          size: fontSize,
          color: emptyColor,
        }),
      ];
    }
    
    case "percentage": {
      const percentage = generateSkillPercentage(proficiency, maxLevel);
      return [
        new TextRun({
          text: `${percentage}%`,
          font: config.bodyFont,
          size: fontSize,
          color: textColor,
        }),
      ];
    }
    
    case "text":
    case "tags":
    default:
      return [];
  }
}

function createSkillsSection(skillCategories: CvSkillCategory[], config: InternalRenderConfig): Paragraph[] {
  if (skillCategories.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Skills", config)];
  
  for (const category of skillCategories) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: category.name,
            font: config.bodyFont,
            size: config.bodySize,
            bold: true,
            color: config.textColor,
          }),
        ],
        spacing: { before: config.itemGap, after: config.itemGap / 2 },
      })
    );
    
    if (config.skillStyle === "tags" || config.skillStyle === "text") {
      const skillNames = generateSkillTags(category.skills).join(", ");
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: skillNames,
              font: config.bodyFont,
              size: config.bodySize,
              color: config.lightTextColor,
            }),
          ],
          spacing: { after: config.itemGap },
        })
      );
    } else {
      for (const skill of category.skills) {
        const skillChildren: TextRun[] = [
          new TextRun({
            text: skill.name + "  ",
            font: config.bodyFont,
            size: config.bodySize,
            color: config.textColor,
          }),
          ...createProficiencyVisual(skill.proficiency, config.skillStyle, config, false),
        ];
        
        elements.push(
          new Paragraph({
            children: skillChildren,
            spacing: { after: config.itemGap / 2 },
          })
        );
      }
    }
  }
  
  return elements;
}

function createLanguagesSection(languages: CvLanguage[], config: InternalRenderConfig): Paragraph[] {
  if (languages.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Languages", config)];
  
  if (config.skillStyle === "text" || config.skillStyle === "tags") {
    const langNames = languages.map(l => l.name).join(", ");
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: langNames,
            font: config.bodyFont,
            size: config.bodySize,
            color: config.lightTextColor,
          }),
        ],
        spacing: { after: config.itemGap },
      })
    );
  } else {
    for (const lang of languages) {
      const langChildren: TextRun[] = [
        new TextRun({
          text: lang.name + "  ",
          font: config.bodyFont,
          size: config.bodySize,
          color: config.textColor,
        }),
        ...createProficiencyVisual(lang.proficiency, config.skillStyle, config, false),
      ];
      
      elements.push(
        new Paragraph({
          children: langChildren,
          spacing: { after: config.itemGap },
        })
      );
    }
  }
  
  return elements;
}

function createCertificationsSection(certifications: CvCertification[], config: InternalRenderConfig): Paragraph[] {
  if (certifications.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Certifications", config)];
  
  for (const cert of certifications) {
    const certChildren: (TextRun | ExternalHyperlink)[] = [
      new TextRun({
        text: cert.name,
        font: config.bodyFont,
        size: config.bodySize,
        bold: true,
        color: config.textColor,
      }),
      new TextRun({
        text: `  •  ${cert.issuer}  •  ${cert.date}`,
        font: config.bodyFont,
        size: config.smallSize,
        color: config.lightTextColor,
      }),
    ];
    
    if (cert.url && isAllowedUrl(cert.url)) {
      certChildren.push(
        new TextRun({
          text: "  ",
          font: config.bodyFont,
          size: config.bodySize,
        })
      );
      certChildren.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: "Verify →",
              font: config.bodyFont,
              size: config.smallSize,
              color: config.accentColor,
              underline: {},
            }),
          ],
          link: cert.url,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: certChildren,
        spacing: { after: config.itemGap },
      })
    );
  }
  
  return elements;
}

function createProjectsSection(projects: CvProject[], config: InternalRenderConfig): Paragraph[] {
  if (projects.length === 0) return [];
  
  const elements: Paragraph[] = [createSectionHeading("Projects", config)];
  
  for (const project of projects) {
    const titleChildren: (TextRun | ExternalHyperlink)[] = [
      new TextRun({
        text: project.name,
        font: config.bodyFont,
        size: config.bodySize,
        bold: true,
        color: config.textColor,
      }),
    ];
    
    if (project.url && isAllowedUrl(project.url)) {
      titleChildren.push(
        new TextRun({
          text: "  ",
          font: config.bodyFont,
          size: config.bodySize,
        })
      );
      titleChildren.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: "View →",
              font: config.bodyFont,
              size: config.smallSize,
              color: config.accentColor,
              underline: {},
            }),
          ],
          link: project.url,
        })
      );
    }
    
    elements.push(
      new Paragraph({
        children: titleChildren,
        spacing: { before: config.itemGap, after: config.itemGap / 2 },
      })
    );
    
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: project.description,
            font: config.bodyFont,
            size: config.bodySize,
            color: config.lightTextColor,
          }),
        ],
        spacing: { after: config.itemGap / 2, line: config.lineHeight },
      })
    );
    
    if (project.technologies && project.technologies.length > 0) {
      const techText = project.technologies.join(" • ");
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: techText,
              font: config.accentFont,
              size: config.smallSize,
              color: config.accentColor,
              italics: true,
            }),
          ],
          spacing: { after: config.itemGap },
        })
      );
    }
  }
  
  return elements;
}

function createSingleColumnLayout(spec: CvSpec, config: InternalRenderConfig): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  
  elements.push(...createHeaderSection(spec.header, config));
  
  if (spec.profile_summary) {
    elements.push(...createProfileSummary(spec.profile_summary, config));
  }
  
  elements.push(...createWorkExperienceSection(spec.work_experience || [], config));
  elements.push(...createEducationSection(spec.education || [], config));
  elements.push(...createSkillsSection(spec.skills || [], config));
  elements.push(...createLanguagesSection(spec.languages || [], config));
  elements.push(...createCertificationsSection(spec.certifications || [], config));
  elements.push(...createProjectsSection(spec.projects || [], config));
  
  return elements;
}

function createTwoColumnLayout(spec: CvSpec, config: InternalRenderConfig): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  
  elements.push(...createHeaderSection(spec.header, config));
  
  if (spec.profile_summary) {
    elements.push(...createProfileSummary(spec.profile_summary, config));
  }
  
  const leftColumnContent: Paragraph[] = [];
  
  const workElements = createWorkExperienceSection(spec.work_experience || [], config);
  for (const el of workElements) {
    if (el instanceof Paragraph) {
      leftColumnContent.push(el);
    }
  }
  
  leftColumnContent.push(...createEducationSection(spec.education || [], config));
  leftColumnContent.push(...createProjectsSection(spec.projects || [], config));
  
  const rightColumnContent: Paragraph[] = [];
  rightColumnContent.push(...createSkillsSection(spec.skills || [], config));
  rightColumnContent.push(...createLanguagesSection(spec.languages || [], config));
  rightColumnContent.push(...createCertificationsSection(spec.certifications || [], config));
  
  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: config.backgroundColor,
  };
  
  const gutterWidth = 5;
  const leftWidth = config.twoColumnLeftWidth;
  const rightWidth = 100 - leftWidth - gutterWidth;
  
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: leftColumnContent,
            width: { size: leftWidth, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
          new TableCell({
            children: [
              new Paragraph({ spacing: { after: 0 } }),
            ],
            width: { size: gutterWidth, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
          }),
          new TableCell({
            children: rightColumnContent,
            width: { size: rightWidth, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
        ],
      }),
    ],
  });
  
  elements.push(table);
  
  return elements;
}

function createSidebarSkillsContent(skillCategories: CvSkillCategory[], config: InternalRenderConfig): Paragraph[] {
  if (skillCategories.length === 0) return [];
  
  const elements: Paragraph[] = [createSidebarSectionHeading("Skills", config)];
  
  for (const category of skillCategories) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: category.name,
            font: config.bodyFont,
            size: config.smallSize,
            bold: true,
            color: config.backgroundColor,
          }),
        ],
        spacing: { before: config.itemGap, after: config.itemGap / 2 },
      })
    );
    
    if (config.skillStyle === "tags" || config.skillStyle === "text") {
      const skillNames = generateSkillTags(category.skills).join(", ");
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: skillNames,
              font: config.bodyFont,
              size: config.smallSize,
              color: config.backgroundColor,
            }),
          ],
          spacing: { after: config.itemGap / 2 },
        })
      );
    } else {
      for (const skill of category.skills) {
        const proficiencyVisual = createProficiencyVisual(skill.proficiency, config.skillStyle, config, true);
        const skillText = proficiencyVisual.length > 0 ? `${skill.name}  ` : skill.name;
        
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: skillText,
                font: config.bodyFont,
                size: config.smallSize,
                color: config.backgroundColor,
              }),
              ...proficiencyVisual,
            ],
            spacing: { after: config.itemGap / 2 },
          })
        );
      }
    }
  }
  
  return elements;
}

function createSidebarLanguagesContent(languages: CvLanguage[], config: InternalRenderConfig): Paragraph[] {
  if (languages.length === 0) return [];
  
  const elements: Paragraph[] = [createSidebarSectionHeading("Languages", config)];
  
  if (config.skillStyle === "text" || config.skillStyle === "tags") {
    const langNames = languages.map(l => l.name).join(", ");
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: langNames,
            font: config.bodyFont,
            size: config.smallSize,
            color: config.backgroundColor,
          }),
        ],
        spacing: { after: config.itemGap / 2 },
      })
    );
  } else {
    for (const lang of languages) {
      const proficiencyVisual = createProficiencyVisual(lang.proficiency, config.skillStyle, config, true);
      const langText = proficiencyVisual.length > 0 ? `${lang.name}  ` : lang.name;
      
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: langText,
              font: config.bodyFont,
              size: config.smallSize,
              color: config.backgroundColor,
            }),
            ...proficiencyVisual,
          ],
          spacing: { after: config.itemGap / 2 },
        })
      );
    }
  }
  
  return elements;
}

function createSidebarLayout(spec: CvSpec, config: InternalRenderConfig): (Paragraph | Table)[] {
  const sidebarContent: Paragraph[] = [];
  
  if (config.showPhoto && spec.header.photo_url) {
    sidebarContent.push(createPhotoPlaceholder(config, true));
  }
  
  sidebarContent.push(
    new Paragraph({
      children: [
        new TextRun({
          text: spec.header.name,
          font: config.headingFont,
          size: config.headingSize,
          bold: true,
          color: config.backgroundColor,
        }),
      ],
      spacing: { after: config.sectionGap / 2 },
    })
  );
  
  const contactItems = [
    { icon: "📞", value: spec.header.phone },
    { icon: "✉", value: spec.header.email },
    { icon: "📍", value: spec.header.address },
  ];
  
  for (const item of contactItems) {
    if (item.value) {
      sidebarContent.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${item.icon} ${item.value}`,
              font: config.bodyFont,
              size: config.smallSize,
              color: config.backgroundColor,
            }),
          ],
          spacing: { after: config.itemGap },
        })
      );
    }
  }
  
  if (spec.header.website && isAllowedUrl(spec.header.website)) {
    sidebarContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "🔗 ",
            font: config.bodyFont,
            size: config.smallSize,
            color: config.backgroundColor,
          }),
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: spec.header.website.replace(/^https?:\/\//, ""),
                font: config.bodyFont,
                size: config.smallSize,
                color: config.backgroundColor,
                underline: {},
              }),
            ],
            link: spec.header.website,
          }),
        ],
        spacing: { after: config.itemGap * 2 },
      })
    );
  }
  
  sidebarContent.push(...createSidebarSkillsContent(spec.skills || [], config));
  sidebarContent.push(...createSidebarLanguagesContent(spec.languages || [], config));
  
  const mainContent: Paragraph[] = [];
  
  if (spec.profile_summary) {
    mainContent.push(createSectionHeading("Profile", config));
    mainContent.push(
      new Paragraph({
        children: [
          new TextRun({
            text: spec.profile_summary,
            font: config.bodyFont,
            size: config.bodySize,
            color: config.lightTextColor,
            italics: true,
          }),
        ],
        spacing: { after: config.sectionGap / 2, line: config.lineHeight },
      })
    );
  }
  
  const workElements = createWorkExperienceSection(spec.work_experience || [], config);
  for (const el of workElements) {
    if (el instanceof Paragraph) {
      mainContent.push(el);
    }
  }
  
  mainContent.push(...createEducationSection(spec.education || [], config));
  mainContent.push(...createProjectsSection(spec.projects || [], config));
  mainContent.push(...createCertificationsSection(spec.certifications || [], config));
  
  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: config.backgroundColor,
  };
  
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: sidebarContent,
            width: { size: config.sidebarWidth, type: WidthType.PERCENTAGE },
            shading: {
              fill: config.sidebarBgColor,
              type: ShadingType.CLEAR,
              color: "auto",
            },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
          new TableCell({
            children: mainContent,
            width: { size: 100 - config.sidebarWidth, type: WidthType.PERCENTAGE },
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
            },
            verticalAlign: VerticalAlign.TOP,
          }),
        ],
      }),
    ],
  });
  
  return [table];
}

export async function renderCvFromSpec(
  spec: CvSpec,
  templateConfig: CvTemplateConfig
): Promise<Buffer> {
  const config = templateConfigToInternal(templateConfig, spec);
  
  let bodyElements: (Paragraph | Table)[];
  
  switch (config.layout) {
    case "two-column":
      bodyElements = createTwoColumnLayout(spec, config);
      break;
    case "sidebar":
      bodyElements = createSidebarLayout(spec, config);
      break;
    case "single-column":
    default:
      bodyElements = createSingleColumnLayout(spec, config);
      break;
  }
  
  // Security: sanitize document metadata
  const safeName = (spec.header.name || "").replace(/[\x00-\x1F\x7F]/g, "").substring(0, 200);

  const doc = new Document({
    title: `CV - ${safeName}`,
    creator: safeName,
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: config.bodyFont, size: config.bodySize },
          paragraph: { spacing: { line: config.lineHeight } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.6),
            },
          },
        },
        children: bodyElements,
      },
    ],
  });
  
  return await Packer.toBuffer(doc);
}
