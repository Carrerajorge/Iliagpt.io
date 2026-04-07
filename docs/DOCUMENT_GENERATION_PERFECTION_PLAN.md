# Plan de mejora, generación de documentos “perfectos” en Iliagpt.io

## Objetivo

Cuando el usuario pida un documento, el sistema debe producir un **Word, Excel o PowerPoint profesional, consistente y descargable**, con una experiencia confiable, predecible y validable.

La regla central del diseño será esta:

> **El LLM no debe improvisar el archivo final.**
> Debe generar una **spec estructurada**, y el software debe **renderizar** el `.docx`, `.xlsx` o `.pptx` de forma determinística.

---

## Diagnóstico del estado actual del repo

El repo ya tiene mucho trabajo avanzado, pero hoy está fragmentado en varias rutas paralelas:

### Backend existente
- Generadores directos por formato:
  - `server/agent/perfectDocumentGenerator.ts`
  - `server/agent/perfectExcelGenerator.ts`
  - `server/agent/perfectPptGenerator.ts`
- Motor spec-driven más sólido:
  - `server/agent/documents/documentEngine.ts`
  - `server/agent/documents/textToSpec.ts`
  - `server/agent/documents/documentValidators.ts`
- Orquestación parcial para specs:
  - `server/services/documentOrchestrator.ts`
- Schemas compartidos, hoy centrados sobre todo en Word/Excel:
  - `shared/documentSpecs.ts`
- Router de documentos ya existente:
  - `server/routes/documentsRouter.ts`

### Frontend existente
- Generación simple por prompt:
  - `client/src/components/document-generator-dialog.tsx`
- Editor avanzado Word basado en código:
  - `client/src/components/word-editor-pro.tsx`
- Editor avanzado Excel:
  - `client/src/components/spreadsheet-editor.tsx`

### Problemas observados
1. **Hay más de una arquitectura de generación conviviendo**.
2. **Word, Excel y PPT no comparten el mismo contrato**.
3. **PowerPoint no está integrado al mismo nivel de producto que Word/Excel**.
4. El flujo actual mezcla:
   - generación libre por prompt,
   - generación vía código,
   - generación vía spec,
   sin una jerarquía clara.
5. “Perfect” hoy depende demasiado del modelo, y no lo suficiente de:
   - plantillas,
   - validación,
   - preview,
   - reparación automática,
   - reglas por formato.

---

## Decisión de arquitectura

## Arquitectura objetivo

```text
Prompt usuario
  -> Intent router de documentos
  -> Brief estructurado
  -> Planner LLM
  -> Spec JSON validada por Zod
  -> Repair loop si falla
  -> Renderer determinístico por formato
  -> Validator de calidad
  -> Preview
  -> Export final
```

## Regla de oro

Separar siempre estas 4 capas:

1. **Intento/brief**: qué quiere el usuario.
2. **Spec**: estructura exacta del documento.
3. **Renderer**: genera el binario Office real.
4. **Validator**: mide calidad y detecta defectos.

---

## Propuesta concreta para Iliagpt.io

## 1. Unificar el contrato documental

### Crear un contrato común
Crear un archivo nuevo, por ejemplo:
- `shared/documentContracts.ts`

Con un esquema raíz:

```ts
DocumentJobSpec = {
  format: 'docx' | 'xlsx' | 'pptx',
  title: string,
  language: string,
  intent: 'report' | 'proposal' | 'invoice' | 'deck' | 'analysis' | 'cv' | 'contract' | ...,
  audience?: string,
  theme?: ThemeSpec,
  quality?: QualitySpec,
  sourceData?: unknown,
  output: DocxSpec | XlsxSpec | PptxSpec,
}
```

### Qué ganaríamos
- mismo pipeline para 3 formatos,
- misma validación de entrada,
- misma telemetría,
- misma UX de preview y export.

### Cambio importante
`shared/documentSpecs.ts` hoy debe **extenderse para PPT** o migrarse al nuevo contrato unificado.

---

## 2. Elegir un solo pipeline “oficial”

### Recomendación
Dejar como pipeline principal:
- `documentOrchestrator` para planificación,
- `documentEngine` para render,
- `documentValidators` para QA.

### Reposicionar los archivos “perfect*”
Los archivos:
- `perfectDocumentGenerator.ts`
- `perfectExcelGenerator.ts`
- `perfectPptGenerator.ts`

no deberían seguir siendo la vía principal si generan contenido y archivo en un solo salto.

### Dos opciones sanas

#### Opción A, recomendada
Convertirlos en **adaptadores legacy** que internamente llamen al pipeline unificado.

#### Opción B
Mover lógica reusable desde `perfect*` hacia:
- plantillas,
- presets,
- helpers de estilo,
- catálogos de layouts.

---

## 3. Añadir un Brief Parser antes del LLM

### Nuevo módulo sugerido
- `server/services/documentBriefParser.ts`

### Responsabilidad
Transformar prompts vagos como:
- “hazme una ppt comercial”
- “créame un excel de ventas”
- “necesito un word formal para presentar al banco”

en un brief estructurado:

```ts
{
  format: 'pptx',
  intent: 'sales_deck',
  audience: 'clientes potenciales',
  language: 'es',
  tone: 'ejecutivo',
  constraints: {
    maxSlides: 10,
    brandRequired: true,
    includeCharts: true,
  }
}
```

### Beneficio
Baja la ambigüedad y hace mucho más consistente la salida.

---

## 4. Implementar planner por formato con salida JSON estricta

### Nuevo módulo sugerido
- `server/services/documentPlanner.ts`

### Responsabilidad
Generar **solo JSON válido**, nunca markup Office ni código ejecutable.

### Estrategia de prompting
Usar prompts distintos por formato:
- `promptDocxPlanner()`
- `promptXlsxPlanner()`
- `promptPptxPlanner()`

### Reglas del prompt
- responder solo JSON,
- seguir schema exacto,
- no inventar campos,
- respetar límites de slides/hojas/secciones,
- no meter texto excesivo por slide,
- no poner fórmulas inválidas,
- no dejar placeholders vacíos.

### Repair loop
Si Zod falla:
1. guardar error estructurado,
2. reenviar al modelo solo el diff de errores,
3. reintentar 1 a 2 veces máximo.

---

## 5. Crear plantillas profesionales de verdad

### Nuevo módulo sugerido
- `server/services/documentTemplates/`

Con presets por formato:

#### DOCX
- informe ejecutivo
- propuesta comercial
- contrato
- carta formal
- CV
- paper académico

#### XLSX
- presupuesto
- dashboard comercial
- flujo de caja
- inventario
- nómina
- cronograma

#### PPTX
- pitch deck
- presentación ejecutiva
- reporte trimestral
- propuesta comercial
- presentación académica
- capacitación

### Cada plantilla debe definir
- estructura mínima,
- tokens visuales,
- secciones obligatorias,
- límites de contenido,
- layouts válidos,
- reglas de calidad.

Esto es una de las claves para acercarse a “perfecto”.

---

## 6. Reforzar renderers determinísticos por formato

### DOCX
Base recomendada:
- mantener `docx`
- usar `documentEngine` como renderer principal

### XLSX
Base recomendada:
- mantener `exceljs`
- reforzar:
  - formatos numéricos,
  - freeze panes,
  - autofilters,
  - validations,
  - named ranges,
  - resumen automático,
  - charts si el renderer final los soporta bien.

### PPTX
Base recomendada:
- mantener `pptxgenjs`
- fortalecer:
  - layout por tipo de slide,
  - límites de texto por caja,
  - autosplit de bullets largos,
  - speaker notes,
  - variantes de slides de datos.

### Recomendación fuerte
El layout no debe depender de texto “a ver si cabe”.
Debe haber:
- heurísticas de densidad,
- autofit,
- truncado controlado,
- split de contenido a otra página/slide.

---

## 7. Validación de calidad por formato

### Mantener y ampliar
- `server/agent/documents/documentValidators.ts`

### Validaciones nuevas sugeridas

#### DOCX
- título obligatorio,
- sin heading jumps fuertes,
- sin secciones vacías,
- tabla consistente,
- longitud máxima por párrafo,
- presencia de cierre/conclusión cuando aplique.

#### XLSX
- fórmulas válidas,
- columnas definidas,
- tipos consistentes,
- no mezclar texto con moneda en la misma columna,
- hojas con nombres válidos,
- freeze panes si es dataset grande,
- totales en reportes financieros.

#### PPTX
- máximo bullets por slide,
- máximo caracteres por bullet,
- contraste mínimo,
- cero overflow visible,
- primera slide = portada,
- última slide = cierre o CTA,
- chart slide solo con data válida.

### Quality score
Agregar un score unificado:

```ts
{
  overall: 0-100,
  structure: 0-100,
  visual: 0-100,
  completeness: 0-100,
  correctness: 0-100,
  issues: ValidationIssue[]
}
```

Ese score debe volver al frontend antes de exportar.

---

## 8. Agregar preview antes del binario final

### Endpoints nuevos sugeridos
- `POST /api/documents/spec`
- `POST /api/documents/preview`
- `POST /api/documents/export`
- `POST /api/documents/validate`
- `GET /api/documents/templates`

### Flujo recomendado
1. usuario escribe prompt,
2. backend devuelve brief + spec + quality score,
3. frontend muestra preview,
4. usuario ajusta,
5. export final.

### Compatibilidad
Mantener:
- `/generate/word`
- `/generate/excel`

como wrappers temporales del pipeline nuevo.

Y añadir:
- `/generate/ppt`

si no existe como flujo de producto consistente.

---

## 9. Rediseño de UX del generador documental

### Componente a evolucionar
- `client/src/components/document-generator-dialog.tsx`

### Problema actual
Hoy es demasiado simple para una promesa de calidad alta.
Solo recibe prompt y dispara generación.

### Nuevo flujo UI

#### Paso 1, tipo de documento
- Word
- Excel
- PowerPoint

#### Paso 2, brief
- objetivo
- audiencia
- idioma
- tono
- branding
- datos adjuntos
- tipo de plantilla

#### Paso 3, preview estructurado
- outline del Word,
- hojas del Excel,
- miniaturas/listado de slides del PPT.

#### Paso 4, validación
- score,
- advertencias,
- botón “mejorar automáticamente”.

#### Paso 5, export
- `.docx`, `.xlsx`, `.pptx`
- opcional `.pdf` si el flujo lo soporta bien.

### Nota importante
`word-editor-pro.tsx` puede quedar como **modo avanzado/manual**, no como camino principal para usuarios comunes.

---

## 10. Branding y assets

Para que el resultado se sienta “perfecto”, agregar soporte explícito a:
- logo,
- colores corporativos,
- nombre de empresa,
- footer,
- portada,
- plantillas por marca.

### Nuevo módulo sugerido
- `server/services/brandKitResolver.ts`

### Input posible
```ts
brandKit: {
  logoAssetId?: string,
  primaryColor?: string,
  secondaryColor?: string,
  fontHeading?: string,
  fontBody?: string,
  footerText?: string,
}
```

Sin brand kit, la salida puede ser correcta, pero rara vez se verá premium.

---

## 11. Telemetría y observabilidad

Instrumentar spans y métricas en:
- `doc.brief.parse`
- `doc.spec.plan`
- `doc.spec.repair`
- `doc.render`
- `doc.validate`
- `doc.export`

### Métricas clave
- tiempo total por formato,
- tasa de repair loop,
- score promedio de calidad,
- tasa de retry,
- errores por renderer,
- densidad promedio por slide/hoja/sección,
- conversión preview -> export.

---

## 12. Estrategia de testing

## Unit tests
- schemas Zod,
- planner parsers,
- validators,
- layout rules.

## Integration tests
- prompt -> spec -> export,
- prompt ambiguo -> brief -> spec válida,
- invalid spec -> repair loop -> spec válida.

## Golden tests
Guardar snapshots de:
- spec JSON,
- outline esperado,
- metadata de salida.

## Regression tests por formato

### DOCX
- contrato,
- informe,
- CV,
- carta formal.

### XLSX
- presupuesto,
- inventario,
- dashboard,
- nómina.

### PPTX
- deck comercial,
- reporte trimestral,
- capacitación,
- pitch.

## E2E visual/funcional
- preview usable,
- export descarga,
- nombre correcto,
- score visible,
- errores accionables.

---

## Roadmap recomendado

## Fase 0, orden interno
**Objetivo:** detener la fragmentación.

Tareas:
- definir pipeline oficial,
- documentar piezas legacy,
- extender shared specs para PPT o migrar a contrato unificado,
- decidir wrappers de compatibilidad.

## Fase 1, Word excelente
**Objetivo:** tener DOCX realmente premium.

Tareas:
- brief parser,
- planner DOCX JSON-only,
- repair loop,
- quality score,
- preview estructurado,
- plantillas: informe, carta, contrato, CV.

## Fase 2, Excel robusto
**Objetivo:** hojas útiles y correctas, no solo bonitas.

Tareas:
- tipos por columna,
- fórmulas confiables,
- validaciones,
- formatos monetarios/fecha,
- resúmenes automáticos,
- plantillas: presupuesto, dashboard, inventario.

## Fase 3, PowerPoint profesional
**Objetivo:** slides ejecutables de negocio.

Tareas:
- contrato PPT unificado,
- planner PPT JSON-only,
- layouts fuertes,
- límites de densidad,
- speaker notes,
- templates: pitch deck, comercial, reporte ejecutivo.

## Fase 4, branding y preview premium
**Objetivo:** que se vea de empresa real.

Tareas:
- brand kit,
- portada y footers,
- miniaturas,
- edición ligera antes de exportar.

## Fase 5, auto-mejora
**Objetivo:** cerrar la brecha entre “bien” y “excelente”.

Tareas:
- botón “mejorar documento”,
- reviewer LLM sobre spec,
- fix automático de warnings,
- aprendizaje sobre plantillas más usadas.

---

## Backlog técnico concreto

## Backend
- [ ] Crear `shared/documentContracts.ts`
- [ ] Añadir soporte PPT al contrato compartido
- [ ] Crear `server/services/documentBriefParser.ts`
- [ ] Crear `server/services/documentPlanner.ts`
- [ ] Crear `server/services/documentRepairLoop.ts`
- [ ] Unificar `documentOrchestrator` con `documentEngine`
- [ ] Relegar `perfect*Generator.ts` a wrappers o adapters
- [ ] Añadir `brandKitResolver.ts`
- [ ] Añadir quality score unificado
- [ ] Añadir telemetría por etapa

## API
- [ ] `POST /api/documents/spec`
- [ ] `POST /api/documents/preview`
- [ ] `POST /api/documents/validate`
- [ ] `POST /api/documents/export`
- [ ] `GET /api/documents/templates`
- [ ] compat wrappers para `/generate/word`, `/generate/excel`, `/generate/ppt`

## Frontend
- [ ] evolucionar `document-generator-dialog.tsx` a wizard
- [ ] añadir opción PowerPoint al flujo principal
- [ ] preview de outline/slides/hojas
- [ ] quality score visible
- [ ] panel de warnings con “autofix”
- [ ] selector de plantilla
- [ ] selector de branding

## QA
- [ ] tests Zod por formato
- [ ] tests de repair loop
- [ ] tests golden por plantilla
- [ ] e2e de export final
- [ ] regresión por overflow PPT
- [ ] regresión por fórmulas Excel
- [ ] regresión por estructura DOCX

---

## Riesgos principales

### 1. Seguir manteniendo dos o tres pipelines
Eso mata la calidad y duplica bugs.

### 2. Querer que el modelo genere el archivo final “solo con prompt”
Eso da demos llamativas, pero producto inconsistente.

### 3. No meter preview antes de export
El usuario descubre errores demasiado tarde.

### 4. No crear plantillas fuertes
Sin plantillas, el sistema será “versátil”, pero no “perfecto”.

---

## Recomendación ejecutiva final

Si hay que priorizar, haría esto en este orden:

1. **Unificar el pipeline documental**.
2. **Hacer Word excelente primero**.
3. **Usar el mismo contrato para Excel**.
4. **Añadir PPT al contrato unificado, no como feature aparte**.
5. **Poner preview + validación + repair loop antes de exportar**.

La oportunidad aquí está buenísima porque el repo ya tiene piezas muy útiles. El problema no es falta de capacidad, es **falta de convergencia**.

---

## Entregable recomendado siguiente

Siguiente paso ideal de implementación:

### Sprint 1
- contrato unificado,
- planner DOCX/XLSX/PPTX,
- preview API,
- wizard frontend básico,
- wrappers compatibles.

### Resultado esperado del Sprint 1
El usuario ya podría pedir:
- un Word formal,
- un Excel útil,
- una PPT ejecutiva,

con **spec validada, preview y export consistente**.
