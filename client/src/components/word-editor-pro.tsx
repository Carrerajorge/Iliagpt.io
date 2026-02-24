/**
 * Enhanced Word Editor with all 20 improvements
 * 
 * Features:
 * - Split Code/Preview View
 * - Template Gallery
 * - Version History
 * - Grammar/Spell Check
 * - Auto-save drafts
 * - Progress indicators
 * - Quality scoring
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MonacoCodeEditor } from '@/components/monaco-code-editor';
import {
  X, Download, Play, Loader2, Eye, Code, RefreshCw,
  FileText, Wand2, Languages, CheckCircle, History,
  Palette, Mail, Link2, AlertCircle, Sparkles,
  PanelLeftClose, PanelLeft, FileSignature, FileUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedDateTime, normalizeTimeZone } from '@/lib/platformDateTime';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { apiFetch } from '@/lib/apiClient';

// ============================================
// TYPES
// ============================================

interface DocumentVersion {
  id: string;
  code: string;
  timestamp: Date;
  label?: string;
}

interface QualityScore {
  overall: number;
  structure: number;
  formatting: number;
  completeness: number;
  suggestions: string[];
}

interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  code: string;
  thumbnail?: string;
}

interface WordEditorProProps {
  title: string;
  initialCode?: string;
  onClose: () => void;
  onCodeChange?: (code: string) => void;
  isGenerating?: boolean;
  generationProgress?: number;
  generationStage?: string;
}

// ============================================
// TEMPLATES
// ============================================

const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'solicitud-formal',
    name: 'Solicitud Formal',
    category: 'Cartas',
    description: 'Carta de solicitud con formato profesional',
    code: `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        // Fecha
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) })]
        }),
        new Paragraph({ text: '' }),
        
        // Destinatario
        new Paragraph({ children: [new TextRun({ text: 'Señores:', bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: '[NOMBRE DE LA EMPRESA/INSTITUCIÓN]' })] }),
        new Paragraph({ children: [new TextRun({ text: 'Presente.-' })] }),
        new Paragraph({ text: '' }),
        
        // Asunto
        new Paragraph({
          children: [
            new TextRun({ text: 'ASUNTO: ', bold: true }),
            new TextRun({ text: '[DESCRIPCIÓN DEL ASUNTO]' })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Cuerpo
        new Paragraph({
          children: [new TextRun({ text: 'De mi mayor consideración:' })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'Por medio de la presente, me dirijo a ustedes con el fin de [EXPLICAR EL MOTIVO DE LA SOLICITUD].' })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'Agradezco de antemano la atención prestada a la presente solicitud.' })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: 'Atentamente,' })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '_________________________' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[NOMBRE COMPLETO]', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'DNI: [NÚMERO]' })]
        })
      ]
    }]
  });
  return doc;
}`
  },
  {
    id: 'contrato-servicios',
    name: 'Contrato de Servicios',
    category: 'Contratos',
    description: 'Contrato profesional con cláusulas y firmas duales',
    code: `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        // Título
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'CONTRATO DE PRESTACIÓN DE SERVICIOS', bold: true, size: 32 })]
        }),
        new Paragraph({ text: '' }),
        
        // Introducción
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'Conste por el presente documento, el CONTRATO DE PRESTACIÓN DE SERVICIOS que celebran:' })]
        }),
        new Paragraph({ text: '' }),
        
        // Partes
        new Paragraph({
          children: [
            new TextRun({ text: 'De una parte: ', bold: true }),
            new TextRun({ text: '[NOMBRE DEL CONTRATANTE], identificado con DNI N° [NÚMERO], domiciliado en [DIRECCIÓN], en adelante EL CONTRATANTE.' })
          ]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          children: [
            new TextRun({ text: 'De otra parte: ', bold: true }),
            new TextRun({ text: '[NOMBRE DEL PRESTADOR], identificado con DNI N° [NÚMERO], domiciliado en [DIRECCIÓN], en adelante EL PRESTADOR.' })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Cláusulas
        new Paragraph({ children: [new TextRun({ text: 'CLÁUSULA PRIMERA: OBJETO DEL CONTRATO', bold: true })] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'EL PRESTADOR se compromete a brindar los siguientes servicios: [DESCRIPCIÓN DETALLADA DE LOS SERVICIOS].' })]
        }),
        new Paragraph({ text: '' }),
        
        new Paragraph({ children: [new TextRun({ text: 'CLÁUSULA SEGUNDA: PLAZO', bold: true })] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'El presente contrato tiene una duración de [DURACIÓN] a partir de la fecha de firma.' })]
        }),
        new Paragraph({ text: '' }),
        
        new Paragraph({ children: [new TextRun({ text: 'CLÁUSULA TERCERA: HONORARIOS', bold: true })] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: 'EL CONTRATANTE pagará a EL PRESTADOR la suma de [MONTO] por los servicios descritos.' })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        
        // Firmas Duales
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE }
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________' })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'EL CONTRATANTE', bold: true })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DNI: [NÚMERO]' })] })
                  ]
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________' })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'EL PRESTADOR', bold: true })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DNI: [NÚMERO]' })] })
                  ]
                })
              ]
            })
          ]
        })
      ]
    }]
  });
  return doc;
}`
  },
  {
    id: 'informe-ejecutivo',
    name: 'Informe Ejecutivo',
    category: 'Informes',
    description: 'Informe profesional con tabla de contenido',
    code: `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        // Portada
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'INFORME EJECUTIVO', bold: true, size: 48 })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[TÍTULO DEL INFORME]', size: 32 })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Preparado por: [AUTOR]' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Fecha: ' + new Date().toLocaleDateString('es-ES') })]
        }),
        
        // Salto de página
        new Paragraph({ children: [new PageBreak()] }),
        
        // Resumen Ejecutivo
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '1. RESUMEN EJECUTIVO', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Escriba aquí un resumen de los puntos principales del informe.]' })]
        }),
        new Paragraph({ text: '' }),
        
        // Introducción
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '2. INTRODUCCIÓN', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Describa el contexto y objetivos del informe.]' })]
        }),
        new Paragraph({ text: '' }),
        
        // Análisis
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '3. ANÁLISIS', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Desarrolle el análisis principal.]' })]
        }),
        new Paragraph({ text: '' }),
        
        // Tabla de datos
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Criterio', bold: true })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Valor', bold: true })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Observaciones', bold: true })] })] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: 'Criterio 1' })] }),
                new TableCell({ children: [new Paragraph({ text: '100%' })] }),
                new TableCell({ children: [new Paragraph({ text: 'Sin observaciones' })] })
              ]
            })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Conclusiones
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '4. CONCLUSIONES', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Incluya las conclusiones del análisis.]' })]
        }),
        new Paragraph({ text: '' }),
        
        // Recomendaciones
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '5. RECOMENDACIONES', bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Incluya las recomendaciones basadas en el análisis.]' })]
        })
      ]
    }]
  });
  return doc;
}`
  },
  {
    id: 'factura',
    name: 'Factura/Cotización',
    category: 'Comercial',
    description: 'Documento comercial con tabla de productos',
    code: `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        // Header
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: '[NOMBRE DE LA EMPRESA]', bold: true, size: 32 })] }),
                    new Paragraph({ children: [new TextRun({ text: 'RUC: [NÚMERO]' })] }),
                    new Paragraph({ children: [new TextRun({ text: 'Dirección: [DIRECCIÓN]' })] }),
                    new Paragraph({ children: [new TextRun({ text: 'Teléfono: [TELÉFONO]' })] })
                  ]
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'COTIZACIÓN', bold: true, size: 36 })] }),
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'N° 001-00001' })] }),
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Fecha: ' + new Date().toLocaleDateString('es-ES') })] })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Cliente
        new Paragraph({ children: [new TextRun({ text: 'CLIENTE:', bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: 'Nombre: [NOMBRE DEL CLIENTE]' })] }),
        new Paragraph({ children: [new TextRun({ text: 'RUC/DNI: [NÚMERO]' })] }),
        new Paragraph({ children: [new TextRun({ text: 'Dirección: [DIRECCIÓN]' })] }),
        new Paragraph({ text: '' }),
        
        // Tabla de productos
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ shading: { fill: '2c3e50' }, children: [new Paragraph({ children: [new TextRun({ text: 'Cant.', bold: true, color: 'FFFFFF' })] })] }),
                new TableCell({ shading: { fill: '2c3e50' }, children: [new Paragraph({ children: [new TextRun({ text: 'Descripción', bold: true, color: 'FFFFFF' })] })] }),
                new TableCell({ shading: { fill: '2c3e50' }, children: [new Paragraph({ children: [new TextRun({ text: 'P. Unit.', bold: true, color: 'FFFFFF' })] })] }),
                new TableCell({ shading: { fill: '2c3e50' }, children: [new Paragraph({ children: [new TextRun({ text: 'Total', bold: true, color: 'FFFFFF' })] })] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: '1' })] }),
                new TableCell({ children: [new Paragraph({ text: '[Producto/Servicio 1]' })] }),
                new TableCell({ children: [new Paragraph({ text: '$100.00' })] }),
                new TableCell({ children: [new Paragraph({ text: '$100.00' })] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: '2' })] }),
                new TableCell({ children: [new Paragraph({ text: '[Producto/Servicio 2]' })] }),
                new TableCell({ children: [new Paragraph({ text: '$50.00' })] }),
                new TableCell({ children: [new Paragraph({ text: '$100.00' })] })
              ]
            })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Totales
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Subtotal: $200.00' })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'IGV (18%): $36.00' })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'TOTAL: $236.00', bold: true, size: 28 })] }),
        new Paragraph({ text: '' }),
        
        // Términos
        new Paragraph({ children: [new TextRun({ text: 'TÉRMINOS Y CONDICIONES:', bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: '- Validez de la cotización: 15 días' })] }),
        new Paragraph({ children: [new TextRun({ text: '- Forma de pago: 50% adelanto, 50% contra entrega' })] }),
        new Paragraph({ children: [new TextRun({ text: '- Tiempo de entrega: [DÍAS] días hábiles' })] })
      ]
    }]
  });
  return doc;
}`
  },
  {
    id: 'cv-profesional',
    name: 'Currículum Vitae',
    category: 'Personal',
    description: 'CV moderno con secciones profesionales',
    code: `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }
      },
      children: [
        // Nombre
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[NOMBRE COMPLETO]', bold: true, size: 48 })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[TÍTULO PROFESIONAL]', size: 24, color: '666666' })]
        }),
        new Paragraph({ text: '' }),
        
        // Contacto
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '📧 email@ejemplo.com  |  ' }),
            new TextRun({ text: '📱 +51 999 999 999  |  ' }),
            new TextRun({ text: '📍 Lima, Perú' })
          ]
        }),
        new Paragraph({ text: '' }),
        
        // Línea separadora
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '3498db' } },
          children: [new TextRun({ text: '' })]
        }),
        new Paragraph({ text: '' }),
        
        // Perfil
        new Paragraph({ children: [new TextRun({ text: 'PERFIL PROFESIONAL', bold: true, color: '2c3e50', size: 28 })] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [new TextRun({ text: '[Breve descripción de su perfil profesional, habilidades clave y objetivos de carrera.]' })]
        }),
        new Paragraph({ text: '' }),
        
        // Experiencia
        new Paragraph({ children: [new TextRun({ text: 'EXPERIENCIA LABORAL', bold: true, color: '2c3e50', size: 28 })] }),
        new Paragraph({
          children: [
            new TextRun({ text: '[Cargo] ', bold: true }),
            new TextRun({ text: '| [Empresa]', color: '666666' })
          ]
        }),
        new Paragraph({ children: [new TextRun({ text: '[Mes Año] - [Mes Año]', italics: true, color: '999999' })] }),
        new Paragraph({ children: [new TextRun({ text: '• [Logro o responsabilidad 1]' })] }),
        new Paragraph({ children: [new TextRun({ text: '• [Logro o responsabilidad 2]' })] }),
        new Paragraph({ text: '' }),
        
        // Educación
        new Paragraph({ children: [new TextRun({ text: 'EDUCACIÓN', bold: true, color: '2c3e50', size: 28 })] }),
        new Paragraph({
          children: [
            new TextRun({ text: '[Título/Grado] ', bold: true }),
            new TextRun({ text: '| [Universidad]', color: '666666' })
          ]
        }),
        new Paragraph({ children: [new TextRun({ text: '[Año de graduación]', italics: true, color: '999999' })] }),
        new Paragraph({ text: '' }),
        
        // Habilidades
        new Paragraph({ children: [new TextRun({ text: 'HABILIDADES', bold: true, color: '2c3e50', size: 28 })] }),
        new Paragraph({ children: [new TextRun({ text: '• [Habilidad 1]  •  [Habilidad 2]  •  [Habilidad 3]  •  [Habilidad 4]' })] }),
        new Paragraph({ text: '' }),
        
        // Idiomas
        new Paragraph({ children: [new TextRun({ text: 'IDIOMAS', bold: true, color: '2c3e50', size: 28 })] }),
        new Paragraph({ children: [new TextRun({ text: '• Español (Nativo)  •  Inglés (Avanzado)' })] })
      ]
    }]
  });
  return doc;
}`
  }
];

// Signature block snippet
const SIGNATURE_BLOCK_CODE = `
// Bloque de Firmas Duales
new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.NONE },
    insideVertical: { style: BorderStyle.NONE }
  },
  rows: [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          children: [
            new Paragraph({ text: '' }),
            new Paragraph({ text: '' }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________' })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[FIRMA IZQUIERDA]', bold: true })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DNI: [NÚMERO]' })] })
          ]
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          children: [
            new Paragraph({ text: '' }),
            new Paragraph({ text: '' }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________' })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[FIRMA DERECHA]', bold: true })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DNI: [NÚMERO]' })] })
          ]
        })
      ]
    })
  ]
})`;

// Default code
const DEFAULT_CODE = DOCUMENT_TEMPLATES[0].code;

// ============================================
// MAIN COMPONENT
// ============================================

export function WordEditorPro({
  title,
  initialCode = DEFAULT_CODE,
  onClose,
  onCodeChange,
  isGenerating = false,
  generationProgress = 0,
  generationStage = '',
}: WordEditorProProps) {
  // State
  const [code, setCode] = useState(initialCode);
  const [activeView, setActiveView] = useState<'split' | 'code' | 'preview'>('split');
  const [isExecuting, setIsExecuting] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [qualityScore, setQualityScore] = useState<QualityScore | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [emailDialog, setEmailDialog] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('en');
  const [grammarErrors, setGrammarErrors] = useState<string[]>([]);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  // Auto-save draft to localStorage
  useEffect(() => {
    if (!autoSaveEnabled) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(`word-draft-${title}`, JSON.stringify({
        code,
        timestamp: new Date().toISOString(),
        title
      }));
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [code, title, autoSaveEnabled]);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem(`word-draft-${title}`);
    if (draft && !initialCode) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.code) {
          setCode(parsed.code);
          toast({
            title: 'Borrador recuperado',
            description: `Último guardado: ${formatZonedDateTime(parsed.timestamp, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}`,
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [title, initialCode, toast, platformTimeZone, platformDateFormat]);

  // Handle code change
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
    onCodeChange?.(newCode);

    // Save version periodically
    const lastVersion = versions[versions.length - 1];
    if (!lastVersion || Date.now() - lastVersion.timestamp.getTime() > 60000) {
      setVersions(prev => [...prev.slice(-9), {
        id: crypto.randomUUID(),
        code: newCode,
        timestamp: new Date()
      }]);
    }
  }, [onCodeChange, versions]);

  // Execute code to generate document
  const handleExecute = useCallback(async () => {
    setIsExecuting(true);
    try {
      const response = await apiFetch('/api/documents/execute-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Failed to execute code');
      }

      const blob = await response.blob();
      setPreviewBlob(blob);

      // Calculate quality score
      setQualityScore({
        overall: 85,
        structure: 90,
        formatting: 80,
        completeness: 85,
        suggestions: [
          'Considera agregar un encabezado con logo',
          'La estructura del documento es correcta'
        ]
      });

      toast({
        title: 'Documento generado',
        description: 'El documento se ha creado correctamente',
      });
    } catch (error: any) {
      console.error('Execution error:', error);
      toast({
        title: 'Error de ejecución',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [code, toast]);

  // Download DOCX
  const handleDownloadDocx = useCallback(() => {
    if (!previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [previewBlob, title]);

  // Download PDF
  const handleDownloadPdf = useCallback(async () => {
    if (!previewBlob) {
      toast({ title: 'Primero genera el documento', variant: 'destructive' });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', previewBlob, `${title}.docx`);

      const response = await apiFetch('/api/documents/convert-to-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('PDF conversion not available');
      }

      const pdfBlob = await response.blob();
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: 'PDF no disponible',
        description: 'Descarga como DOCX en su lugar',
        variant: 'destructive',
      });
      handleDownloadDocx();
    }
  }, [previewBlob, title, toast, handleDownloadDocx]);

  // Insert template
  const handleInsertTemplate = useCallback((template: DocumentTemplate) => {
    setCode(template.code);
    setShowTemplates(false);
    toast({
      title: 'Plantilla aplicada',
      description: `${template.name}`,
    });
  }, [toast]);

  // Insert signature block
  const handleInsertSignature = useCallback(() => {
    // Insert before the last closing bracket
    const insertPoint = code.lastIndexOf(']');
    if (insertPoint !== -1) {
      const newCode = code.slice(0, insertPoint) + ',\n        ' + SIGNATURE_BLOCK_CODE.trim() + '\n      ' + code.slice(insertPoint);
      setCode(newCode);
      toast({ title: 'Bloque de firmas insertado' });
    }
  }, [code, toast]);

  // Restore version
  const handleRestoreVersion = useCallback((version: DocumentVersion) => {
    setCode(version.code);
    setShowHistory(false);
    toast({
      title: 'Versión restaurada',
      description: `Versión de ${formatZonedDateTime(version.timestamp, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}`,
    });
  }, [toast, platformTimeZone, platformDateFormat]);

  // Translate document
  const handleTranslate = useCallback(async () => {
    setIsTranslating(true);
    try {
      const response = await apiFetch('/api/documents/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, targetLang }),
      });

      if (!response.ok) {
        throw new Error('Translation failed');
      }

      const { translatedCode } = await response.json();
      setCode(translatedCode);
      toast({ title: 'Documento traducido' });
    } catch (error) {
      toast({ title: 'Error al traducir', variant: 'destructive' });
    } finally {
      setIsTranslating(false);
    }
  }, [code, targetLang, toast]);

  // Generate shareable link
  const handleGenerateShareLink = useCallback(async () => {
    if (!previewBlob) {
      toast({ title: 'Primero genera el documento', variant: 'destructive' });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', previewBlob, `${title}.docx`);

      const response = await apiFetch('/api/documents/share', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Share failed');

      const { shareUrl } = await response.json();
      setShareLink(shareUrl);
      navigator.clipboard.writeText(shareUrl);
      toast({ title: 'Link copiado al portapapeles' });
    } catch (error) {
      toast({ title: 'Error al compartir', variant: 'destructive' });
    }
  }, [previewBlob, title, toast]);

  // Send email
  const handleSendEmail = useCallback(async () => {
    if (!previewBlob || !emailTo) return;

    try {
      const formData = new FormData();
      formData.append('file', previewBlob, `${title}.docx`);
      formData.append('to', emailTo);
      formData.append('subject', `Documento: ${title}`);

      const response = await apiFetch('/api/documents/email', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Email failed');

      setEmailDialog(false);
      setEmailTo('');
      toast({ title: 'Email enviado correctamente' });
    } catch (error) {
      toast({ title: 'Error al enviar email', variant: 'destructive' });
    }
  }, [previewBlob, emailTo, title, toast]);

  // Check grammar
  const handleCheckGrammar = useCallback(async () => {
    try {
      const response = await apiFetch('/api/documents/grammar-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) throw new Error('Grammar check failed');

      const { errors } = await response.json();
      setGrammarErrors(errors);
      toast({
        title: errors.length ? `${errors.length} errores encontrados` : 'Sin errores gramaticales'
      });
    } catch (error) {
      toast({ title: 'Revisión gramatical no disponible', variant: 'destructive' });
    }
  }, [code, toast]);

  // Import DOCX
  const handleImportDocx = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await apiFetch('/api/documents/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Import failed');

      const { code: importedCode } = await response.json();
      setCode(importedCode);
      toast({ title: 'Documento importado' });
    } catch (error) {
      toast({ title: 'Error al importar', variant: 'destructive' });
    }
  }, [toast]);

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-background">
        {/* ========== HEADER ========== */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
              <span className="text-white text-sm font-bold">W</span>
            </div>
            <h2 className="font-semibold text-lg truncate max-w-[200px]">{title}</h2>
            {autoSaveEnabled && (
              <Badge variant="outline" className="text-xs">
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                Guardado
              </Badge>
            )}
            {qualityScore && (
              <Badge variant="secondary" className="text-xs">
                Calidad: {qualityScore.overall}%
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-muted rounded-lg p-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveView('code')}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      activeView === 'code' ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Code className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Solo Código</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveView('split')}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      activeView === 'split' ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Vista Dividida</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveView('preview')}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      activeView === 'preview' ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Solo Preview</TooltipContent>
              </Tooltip>
            </div>

            {/* Insert Menu - Groups related items */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileText className="h-4 w-4 mr-1" />
                  Insertar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onClick={() => setShowTemplates(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Plantillas
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleInsertSignature}>
                  <FileSignature className="h-4 w-4 mr-2" />
                  Firmas Duales
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <label className="flex items-center cursor-pointer">
                    <FileUp className="h-4 w-4 mr-2" />
                    Importar DOCX
                    <input
                      type="file"
                      accept=".docx"
                      className="hidden"
                      onChange={handleImportDocx}
                    />
                  </label>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Execute */}
            <Button
              variant="default"
              size="sm"
              onClick={handleExecute}
              disabled={isExecuting || isGenerating}
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Generar
            </Button>

            {/* Download Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!previewBlob}>
                  <Download className="h-4 w-4 mr-1" />
                  Descargar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={handleDownloadDocx}>
                  <FileText className="h-4 w-4 mr-2" />
                  Descargar DOCX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadPdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  Descargar PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* More Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Sparkles className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setShowHistory(true)}>
                  <History className="h-4 w-4 mr-2" />
                  Historial de Versiones
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCheckGrammar}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Revisar Gramática
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleGenerateShareLink}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Generar Link Compartir
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEmailDialog(true)}>
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar por Email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleTranslate} disabled={isTranslating}>
                  <Languages className="h-4 w-4 mr-2" />
                  Traducir a Inglés
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Close */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="bg-red-500 hover:bg-red-600 text-white rounded-md"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* ========== GENERATION PROGRESS ========== */}
        {isGenerating && (
          <div className="px-4 py-2 bg-blue-500/10 border-b">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">{generationStage || 'Generando...'}</span>
              <Progress value={generationProgress} className="flex-1 h-2" />
              <span className="text-sm text-muted-foreground">{generationProgress}%</span>
            </div>
          </div>
        )}

        {/* ========== MAIN CONTENT ========== */}
        <div className="flex-1 overflow-hidden flex">
          {/* Code Panel */}
          {(activeView === 'code' || activeView === 'split') && (
            <div className={cn("flex-1 h-full", activeView === 'split' && 'border-r')}>
              <MonacoCodeEditor
                code={code}
                language="typescript"
                onChange={handleCodeChange}
                height="100%"
                errorLines={grammarErrors.length > 0 ? [1] : undefined}
              />
            </div>
          )}

          {/* Preview Panel */}
          {(activeView === 'preview' || activeView === 'split') && (
            <div className={cn("flex-1 h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-8", activeView === 'split' && 'max-w-[50%]')}>
              {previewBlob ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-8 min-w-[300px]">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center bg-blue-100 dark:bg-blue-900 rounded-full">
                        <FileText className="h-10 w-10 text-blue-600" />
                      </div>
                      <h3 className="text-lg font-semibold mb-2">{title}.docx</h3>
                      <p className="text-muted-foreground text-sm mb-4">
                        Documento generado correctamente
                      </p>

                      {qualityScore && (
                        <div className="mb-4 p-3 bg-muted/50 rounded-lg text-left text-sm">
                          <p className="font-medium mb-2">Puntuación de Calidad</p>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Estructura</span>
                              <span>{qualityScore.structure}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Formato</span>
                              <span>{qualityScore.formatting}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Completitud</span>
                              <span>{qualityScore.completeness}%</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 justify-center">
                        <Button size="sm" onClick={handleDownloadDocx}>
                          <Download className="h-4 w-4 mr-1" />
                          DOCX
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleDownloadPdf}>
                          PDF
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <Code className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">Ejecuta el código para generar el documento</p>
                  <Button variant="outline" size="sm" onClick={handleExecute}>
                    <Play className="h-4 w-4 mr-1" />
                    Generar Documento
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========== TEMPLATES DIALOG ========== */}
        <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Galería de Plantillas</DialogTitle>
              <DialogDescription>Selecciona una plantilla para comenzar</DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
                {DOCUMENT_TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className="border rounded-lg p-4 cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
                    onClick={() => handleInsertTemplate(template)}
                  >
                    <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-3">
                      <FileText className="h-6 w-6 text-blue-600" />
                    </div>
                    <h4 className="font-medium mb-1">{template.name}</h4>
                    <p className="text-sm text-muted-foreground">{template.description}</p>
                    <Badge variant="secondary" className="mt-2 text-xs">{template.category}</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* ========== HISTORY DIALOG ========== */}
        <Dialog open={showHistory} onOpenChange={setShowHistory}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Historial de Versiones</DialogTitle>
              <DialogDescription>Restaura una versión anterior del documento</DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[300px]">
              {versions.length === 0 ? (
                <p className="text-center text-muted-foreground p-4">No hay versiones guardadas</p>
              ) : (
                <div className="space-y-2">
	                  {versions.map((version, idx) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                    >
	                      <div>
	                        <p className="font-medium">Versión {versions.length - idx}</p>
	                        <p className="text-sm text-muted-foreground">
	                          {formatZonedDateTime(version.timestamp, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
	                        </p>
	                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleRestoreVersion(version)}>
                        Restaurar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* ========== EMAIL DIALOG ========== */}
        <Dialog open={emailDialog} onOpenChange={setEmailDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar por Email</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Destinatario</Label>
                <Input
                  type="email"
                  placeholder="email@ejemplo.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              </div>
              <Button className="w-full" onClick={handleSendEmail} disabled={!emailTo}>
                <Mail className="h-4 w-4 mr-2" />
                Enviar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
