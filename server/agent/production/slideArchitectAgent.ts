/**
 * Slide Architect Agent
 * 
 * Diseña presentaciones con narrativa:
 * - Story Arc (Problema → Insight → Evidencia → Implicación → Recomendación)
 * - Tipos de slides
 * - Densidad controlada
 * - Vinculación con Word/Excel
 */

import OpenAI from 'openai';
import { z } from 'zod';
import type { ContentSpec, EvidencePack } from './types';
import type { OutlineSpec, DeliverableMap } from './blueprintAgent';
import type { AnalysisResult, KeyFinding } from './analysisAgent';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

const MODEL = 'grok-4-1-fast-non-reasoning';

// ============================================================================
// Schemas
// ============================================================================

export const SlideTypeSchema = z.enum([
    'title',           // Portada
    'agenda',          // Agenda/Índice
    'section_header',  // Divisor de sección
    'context',         // Contexto/Situación
    'problem',         // Problema/Oportunidad
    'insight',         // Insight clave
    'data',            // Datos/Gráfico
    'comparison',      // Comparación
    'finding',         // Hallazgo
    'quote',           // Cita destacada
    'timeline',        // Cronología
    'process',         // Proceso/Flujo
    'recommendations', // Recomendaciones
    'conclusion',      // Conclusión
    'closing',         // Cierre/CTA
    'qanda',           // Q&A
]);
export type SlideType = z.infer<typeof SlideTypeSchema>;

export const BulletPointSchema = z.object({
    text: z.string(),
    level: z.number().min(0).max(2),
    emphasis: z.boolean().optional(),
});
export type BulletPoint = z.infer<typeof BulletPointSchema>;

export const SlideSchema = z.object({
    id: z.string(),
    order: z.number(),
    type: SlideTypeSchema,
    title: z.string(),
    subtitle: z.string().optional(),
    bullets: z.array(BulletPointSchema).optional(),
    speakerNotes: z.string().optional(),
    chartRef: z.string().optional(), // Referencia a Excel
    imagePrompt: z.string().optional(), // Para generar imágenes
    wordSectionRef: z.string().optional(), // Referencia a Word
    dataRef: z.string().optional(), // Referencia a datos
    transitionNote: z.string().optional(), // Nota de transición narrativa
});
export type Slide = z.infer<typeof SlideSchema>;

export const SlideDeckSpecSchema = z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string().optional(),
    date: z.string(),
    theme: z.string(),
    slides: z.array(SlideSchema),
    storyArc: z.array(z.string()),
    totalSlides: z.number(),
    estimatedDuration: z.number(), // minutos
    keyMessages: z.array(z.string()),
});
export type SlideDeckSpec = z.infer<typeof SlideDeckSpecSchema>;

// ============================================================================
// Story Arc Templates
// ============================================================================

const STORY_ARCS: Record<string, string[]> = {
    executive: [
        'Título y Contexto',
        'Problema/Desafío',
        'Hallazgos Clave',
        'Datos de Soporte',
        'Implicaciones',
        'Recomendaciones',
        'Próximos Pasos',
        'Cierre',
    ],
    academic: [
        'Título',
        'Agenda',
        'Introducción',
        'Marco Teórico',
        'Metodología',
        'Resultados',
        'Discusión',
        'Conclusiones',
        'Limitaciones',
        'Referencias',
    ],
    sales: [
        'Apertura Impactante',
        'Problema del Cliente',
        'Consecuencias',
        'Nuestra Solución',
        'Beneficios',
        'Casos de Éxito',
        'Propuesta de Valor',
        'Llamada a la Acción',
    ],
    technical: [
        'Título',
        'Objetivo',
        'Contexto Técnico',
        'Arquitectura/Diseño',
        'Implementación',
        'Resultados',
        'Lecciones Aprendidas',
        'Próximos Pasos',
    ],
    default: [
        'Título',
        'Agenda',
        'Contexto',
        'Análisis',
        'Hallazgos',
        'Conclusiones',
        'Recomendaciones',
        'Q&A',
    ],
};

// ============================================================================
// Density Rules
// ============================================================================

const SLIDE_DENSITY_RULES = {
    maxBullets: 5,
    maxWordsPerBullet: 15,
    maxWordsPerTitle: 10,
    maxWordsPerSlide: 75, // Total
    maxChartsPerSlide: 1,
    minSlideTime: 1, // minutos
    maxSlideTime: 3,
};

// ============================================================================
// Slide Architect Agent
// ============================================================================

export async function designSlideDeck(
    topic: string,
    outline: OutlineSpec,
    analysis: AnalysisResult,
    deliverableMap: DeliverableMap,
    evidence: EvidencePack,
    audience: string
): Promise<SlideDeckSpec> {
    console.log(`[SlideArchitectAgent] Designing slide deck for: ${topic}`);

    // 1. Select story arc
    const storyArc = selectStoryArc(audience);

    // 2. Generate slides structure with LLM
    const slides = await generateSlides(
        topic,
        outline,
        analysis,
        storyArc,
        deliverableMap.pptConfig.totalSlides
    );

    // 3. Populate with content
    const populatedSlides = await populateSlides(slides, analysis, evidence);

    // 4. Apply density rules
    const optimizedSlides = applyDensityRules(populatedSlides);

    // 5. Add transitions and speaker notes
    const finalSlides = addNarrativeElements(optimizedSlides, analysis);

    // 6. Extract key messages
    const keyMessages = extractKeyMessages(analysis);

    return {
        title: outline.title,
        subtitle: outline.subtitle,
        date: new Date().toISOString().split('T')[0],
        theme: audience === 'executive' ? 'corporate' : 'modern',
        slides: finalSlides,
        storyArc,
        totalSlides: finalSlides.length,
        estimatedDuration: finalSlides.length * 2, // 2 min/slide promedio
        keyMessages,
    };
}

// ============================================================================
// Implementation
// ============================================================================

function selectStoryArc(audience: string): string[] {
    switch (audience) {
        case 'executive':
            return STORY_ARCS.executive;
        case 'academic':
            return STORY_ARCS.academic;
        case 'technical':
            return STORY_ARCS.technical;
        default:
            return STORY_ARCS.default;
    }
}

async function generateSlides(
    topic: string,
    outline: OutlineSpec,
    analysis: AnalysisResult,
    storyArc: string[],
    maxSlides: number
): Promise<Slide[]> {
    const findingsText = analysis.keyFindings
        .slice(0, 5)
        .map(f => `- ${f.title}: ${f.description}`)
        .join('\n');

    const prompt = `Diseña una presentación de máximo ${maxSlides} slides:

TEMA: ${topic}

STORY ARC A SEGUIR:
${storyArc.map((s, i) => `${i + 1}. ${s}`).join('\n')}

HALLAZGOS CLAVE PARA INCLUIR:
${findingsText}

TESIS PRINCIPAL:
${analysis.argumentGraph.thesis}

SECCIONES DEL DOCUMENTO:
${outline.sections.map(s => `- ${s.title}`).join('\n')}

Responde en JSON:
{
  "slides": [
    {
      "id": "s1",
      "order": 1,
      "type": "title|agenda|context|problem|insight|data|finding|recommendations|conclusion|closing|qanda",
      "title": "Título (máximo 10 palabras)",
      "subtitle": "Subtítulo opcional",
      "bullets": [
        {"text": "punto (máximo 15 palabras)", "level": 0, "emphasis": false}
      ],
      "wordSectionRef": "id de sección del documento si aplica",
      "transitionNote": "cómo conecta con la siguiente slide"
    }
  ]
}

REGLAS:
- Máximo 5 bullets por slide
- Cada bullet máximo 15 palabras
- Título máximo 10 palabras
- Usa "finding" para hallazgos importantes
- Usa "data" si hay datos numéricos
- La narrativa debe fluir naturalmente`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 3000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            return z.array(SlideSchema).parse(parsed.slides || parsed);
        }
    } catch (error) {
        console.error('[SlideArchitectAgent] Failed to generate slides:', error);
    }

    // Fallback - basic structure
    return createFallbackSlides(topic, storyArc, analysis);
}

function createFallbackSlides(
    topic: string,
    storyArc: string[],
    analysis: AnalysisResult
): Slide[] {
    const slides: Slide[] = [
        {
            id: 's1',
            order: 1,
            type: 'title',
            title: topic,
            subtitle: new Date().toLocaleDateString(),
        },
        {
            id: 's2',
            order: 2,
            type: 'agenda',
            title: 'Agenda',
            bullets: storyArc.slice(2, -1).map((item, i) => ({
                text: item,
                level: 0,
            })),
        },
    ];

    // Add findings as slides
    analysis.keyFindings.slice(0, 3).forEach((finding, i) => {
        slides.push({
            id: `sf${i}`,
            order: slides.length + 1,
            type: 'finding',
            title: finding.title,
            bullets: [
                { text: finding.description, level: 0 },
                ...finding.implications.slice(0, 2).map(imp => ({ text: imp, level: 1 })),
            ],
        });
    });

    // Conclusion
    slides.push({
        id: 'sc',
        order: slides.length + 1,
        type: 'conclusion',
        title: 'Conclusiones',
        bullets: analysis.keyFindings.slice(0, 3).map(f => ({
            text: f.title,
            level: 0,
        })),
    });

    // Q&A
    slides.push({
        id: 'sq',
        order: slides.length + 1,
        type: 'qanda',
        title: '¿Preguntas?',
        subtitle: 'Gracias por su atención',
    });

    return slides;
}

async function populateSlides(
    slides: Slide[],
    analysis: AnalysisResult,
    evidence: EvidencePack
): Promise<Slide[]> {
    return slides.map(slide => {
        // Link data slides to evidence
        if (slide.type === 'data' && evidence.dataPoints.length > 0) {
            const relevantData = evidence.dataPoints.slice(0, 3);
            return {
                ...slide,
                dataRef: JSON.stringify(relevantData),
                speakerNotes: `Datos: ${relevantData.map(d => `${d.label}: ${d.value}`).join(', ')}`,
            };
        }

        // Link finding slides to analysis
        if (slide.type === 'finding') {
            const matchingFinding = analysis.keyFindings.find(f =>
                slide.title.toLowerCase().includes(f.title.toLowerCase().substring(0, 20))
            );
            if (matchingFinding) {
                return {
                    ...slide,
                    speakerNotes: `Hallazgo: ${matchingFinding.description}. Acción: ${matchingFinding.recommendedAction || 'N/A'}`,
                };
            }
        }

        return slide;
    });
}

function applyDensityRules(slides: Slide[]): Slide[] {
    return slides.map(slide => {
        const optimized = { ...slide };

        // Limit bullets
        if (optimized.bullets && optimized.bullets.length > SLIDE_DENSITY_RULES.maxBullets) {
            optimized.bullets = optimized.bullets.slice(0, SLIDE_DENSITY_RULES.maxBullets);
        }

        // Truncate long bullets
        if (optimized.bullets) {
            optimized.bullets = optimized.bullets.map(bullet => ({
                ...bullet,
                text: truncateWords(bullet.text, SLIDE_DENSITY_RULES.maxWordsPerBullet),
            }));
        }

        // Truncate title
        optimized.title = truncateWords(optimized.title, SLIDE_DENSITY_RULES.maxWordsPerTitle);

        return optimized;
    });
}

function addNarrativeElements(slides: Slide[], analysis: AnalysisResult): Slide[] {
    return slides.map((slide, index) => {
        const hasNext = index < slides.length - 1;
        const nextSlide = hasNext ? slides[index + 1] : null;

        // Add transition note if not present
        if (!slide.transitionNote && nextSlide) {
            slide.transitionNote = generateTransition(slide.type, nextSlide.type);
        }

        // Add speaker notes if not present
        if (!slide.speakerNotes) {
            slide.speakerNotes = generateSpeakerNote(slide, analysis);
        }

        return slide;
    });
}

function generateTransition(currentType: SlideType, nextType: SlideType): string {
    const transitions: Record<string, string> = {
        'context_finding': 'Dado este contexto, veamos los principales hallazgos...',
        'finding_data': 'Estos hallazgos están respaldados por los siguientes datos...',
        'data_recommendations': 'Basándonos en estos datos, recomendamos...',
        'finding_finding': 'Otro hallazgo importante es...',
        'recommendations_conclusion': 'En resumen...',
    };

    return transitions[`${currentType}_${nextType}`] || '';
}

function generateSpeakerNote(slide: Slide, analysis: AnalysisResult): string {
    switch (slide.type) {
        case 'title':
            return `Bienvenidos a esta presentación sobre ${slide.title}`;
        case 'agenda':
            return 'Esta es la estructura de nuestra presentación';
        case 'finding':
            return `Punto clave: ${slide.bullets?.[0]?.text || slide.title}`;
        case 'conclusion':
            return `Resumiendo: ${analysis.argumentGraph.thesis}`;
        case 'qanda':
            return 'Abrir espacio para preguntas y comentarios';
        default:
            return '';
    }
}

function truncateWords(text: string, maxWords: number): string {
    const words = text.split(' ');
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '...';
}

function extractKeyMessages(analysis: AnalysisResult): string[] {
    return [
        analysis.argumentGraph.thesis,
        ...analysis.keyFindings
            .filter(f => f.severity === 'critical' || f.severity === 'major')
            .slice(0, 3)
            .map(f => f.title),
    ];
}

// ============================================================================
// Exports
// ============================================================================

export { STORY_ARCS, SLIDE_DENSITY_RULES };
