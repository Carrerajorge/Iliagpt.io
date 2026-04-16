export interface CvTemplateConfig {
  name: string;
  description: string;
  layout: 'single-column' | 'two-column' | 'sidebar';
  sidebarWidth?: number;
  twoColumnLeftWidth?: number;
  twoColumnRightWidth?: number;
  fonts: {
    heading: string;
    body: string;
    accent: string;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    lightText: string;
    background: string;
    sidebarBg?: string;
  };
  spacing: {
    sectionGap: number;
    itemGap: number;
    lineHeight: number;
  };
  skillStyle: 'dots' | 'bars' | 'tags' | 'percentage' | 'text';
  showPhoto: boolean;
  photoShape: 'circle' | 'square' | 'rounded';
}

export const cvTemplates: Record<string, CvTemplateConfig> = {
  modern: {
    name: 'modern',
    description: 'A contemporary two-column layout with blue accents and clean typography',
    layout: 'two-column',
    twoColumnLeftWidth: 65,
    twoColumnRightWidth: 35,
    fonts: {
      heading: 'Calibri',
      body: 'Calibri',
      accent: 'Calibri Light',
    },
    colors: {
      primary: '#1e40af',
      secondary: '#3b82f6',
      accent: '#2563eb',
      text: '#1f2937',
      lightText: '#6b7280',
      background: '#ffffff',
    },
    spacing: {
      sectionGap: 24,
      itemGap: 12,
      lineHeight: 1.5,
    },
    skillStyle: 'bars',
    showPhoto: true,
    photoShape: 'circle',
  },

  classic: {
    name: 'classic',
    description: 'A traditional single-column layout with serif fonts and minimal styling',
    layout: 'single-column',
    fonts: {
      heading: 'Times New Roman',
      body: 'Times New Roman',
      accent: 'Times New Roman',
    },
    colors: {
      primary: '#1a1a1a',
      secondary: '#333333',
      accent: '#4a4a4a',
      text: '#1a1a1a',
      lightText: '#666666',
      background: '#ffffff',
    },
    spacing: {
      sectionGap: 20,
      itemGap: 10,
      lineHeight: 1.4,
    },
    skillStyle: 'text',
    showPhoto: false,
    photoShape: 'square',
  },

  creative: {
    name: 'creative',
    description: 'A bold sidebar layout with vibrant colors and tag-style skill indicators',
    layout: 'sidebar',
    sidebarWidth: 35,
    fonts: {
      heading: 'Calibri',
      body: 'Calibri',
      accent: 'Calibri',
    },
    colors: {
      primary: '#7c3aed',
      secondary: '#a78bfa',
      accent: '#8b5cf6',
      text: '#1f2937',
      lightText: '#6b7280',
      background: '#ffffff',
      sidebarBg: '#7c3aed',
    },
    spacing: {
      sectionGap: 28,
      itemGap: 14,
      lineHeight: 1.6,
    },
    skillStyle: 'tags',
    showPhoto: true,
    photoShape: 'circle',
  },

  minimalist: {
    name: 'minimalist',
    description: 'A clean single-column layout with grayscale palette and dot skill indicators',
    layout: 'single-column',
    twoColumnLeftWidth: 60,
    twoColumnRightWidth: 40,
    fonts: {
      heading: 'Helvetica',
      body: 'Helvetica',
      accent: 'Helvetica Light',
    },
    colors: {
      primary: '#374151',
      secondary: '#6b7280',
      accent: '#9ca3af',
      text: '#374151',
      lightText: '#9ca3af',
      background: '#ffffff',
    },
    spacing: {
      sectionGap: 32,
      itemGap: 16,
      lineHeight: 1.7,
    },
    skillStyle: 'dots',
    showPhoto: false,
    photoShape: 'circle',
  },
};

export function getCvTemplate(style: string): CvTemplateConfig {
  return cvTemplates[style] || cvTemplates.modern;
}

export function getAllCvTemplateNames(): string[] {
  return Object.keys(cvTemplates);
}
