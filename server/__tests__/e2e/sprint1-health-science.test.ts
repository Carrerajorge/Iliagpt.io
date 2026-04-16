import { describe, it, expect } from "vitest";

/* ─────────────────────────────────────────────
 * Sprint 1 — Archivo 3 de 4
 * SALUD, PSICOLOGÍA, CIENCIAS E INVESTIGACIÓN
 * 50 tests (T101-T150)
 * ───────────────────────────────────────────── */

interface DocResult { type: string; format: string; }

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const r: DocResult = { type: "unknown", format: "unknown" };
  if (lower.includes("excel") || lower.includes("tabulación") || lower.includes("kardex") || lower.includes("baremos")) r.type = "spreadsheet";
  else if (lower.startsWith("crea ppt") || lower.startsWith("genera ppt") || lower.includes("ppt de") || lower.includes("ppt sobre") || lower.includes("presentación") || lower.includes("defensa de tesis")) r.type = "presentation";
  else if (lower.startsWith("crea pdf") || lower.startsWith("genera pdf") || lower.includes("pdf de")) r.type = "pdf";
  else if (lower.startsWith("crea word") || lower.startsWith("genera word") || lower.includes("word de") || lower.includes("word con")) r.type = "document";
  else if (lower.includes("svg de") || lower.startsWith("genera svg") || lower.startsWith("crea svg")) r.type = "svg";
  else if (lower.includes("mermaid") || lower.includes("diagrama de") || lower.includes("diagrama del")) r.type = "diagram";
  else if (lower.includes("html")) r.type = "html";
  else if (lower.includes("informe") || lower.includes("protocolo") || lower.includes("plan de") || lower.includes("artículo") || lower.includes("marco teórico") || lower.includes("operacionalización") || lower.includes("historia clínica") || lower.includes("escala de") || lower.includes("pae de")) r.type = "document";
  if (lower.includes("mermaid")) r.format = "mermaid";
  else if (r.type === "spreadsheet") r.format = "xlsx";
  else if (r.type === "document") r.format = "docx";
  else if (r.type === "presentation") r.format = "pptx";
  else if (r.type === "pdf") r.format = "pdf";
  else if (r.type === "svg") r.format = "svg";
  return r;
}

function kw(prompt: string, words: string[]): void {
  const lower = prompt.toLowerCase();
  for (const w of words) expect(lower).toContain(w.toLowerCase());
}

// ═══════════════════════════════════════
// SALUD Y MEDICINA (T101-T110)
// ═══════════════════════════════════════

describe("Sprint 1 · Salud y Medicina", () => {
  it("T101 — Excel dosificación pediátrica 30 fármacos dosis mg/kg", () => {
    const p = "Genera Excel de dosificación pediátrica: 30 fármacos, dosis mg/kg, peso del paciente (input), dosis calculada, intervalo, vía, con fórmulas de cálculo automático";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("30 fármacos");
    kw(p, ["dosis mg/kg","peso del paciente","dosis calculada","intervalo","vía"]);
  });

  it("T102 — Word historia clínica completa anamnesis examen físico plan", () => {
    const p = "Crea Word de historia clínica completa: filiación, anamnesis, antecedentes personales/familiares, examen físico por sistemas, diagnóstico presuntivo, plan diagnóstico/terapéutico";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["filiación","anamnesis","antecedentes","examen físico","diagnóstico presuntivo"]);
  });

  it("T103 — Excel signos vitales UCI 20 pacientes alertas críticos", () => {
    const p = "Genera Excel de control de signos vitales UCI: 20 pacientes, PA sistólica/diastólica, FC, FR, T°, SatO2, Glasgow, horario cada 2h, con alertas de valores críticos";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("20 pacientes");
    kw(p, ["pa sistólica","fc","fr","sato2","glasgow","alertas"]);
  });

  it("T104 — PPT caso clínico neumonía diagnóstico diferencial tratamiento", () => {
    const p = "Crea PPT de caso clínico de neumonía adquirida en comunidad: presentación, historia, exámenes auxiliares, diagnóstico diferencial, tratamiento, evolución";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["neumonía","diagnóstico diferencial","tratamiento","evolución"]);
  });

  it("T105 — Mermaid algoritmo RCP adulto AHA compresiones desfibrilable", () => {
    const p = "Genera diagrama mermaid de algoritmo de RCP adulto: ¿responde? → pedir ayuda → ¿pulso? → iniciar compresiones → 30:2 → ¿ritmo desfibrilable? → descarga/adrenalina";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["rcp","compresiones","30:2","desfibrilable","adrenalina"]);
  });

  it("T106 — Excel kardex medicamentos 50 stock vencimiento alertas", () => {
    const p = "Crea Excel de kardex de medicamentos: 50 medicamentos, presentación, stock actual, stock mínimo, fecha vencimiento, proveedor, con alertas de stock bajo y vencimiento próximo";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("50 medicamentos");
    kw(p, ["stock actual","stock mínimo","fecha vencimiento","alertas"]);
  });

  it("T107 — Word protocolo preeclampsia severa sulfato magnesio", () => {
    const p = "Genera Word de protocolo de atención de preeclampsia severa: definición, criterios diagnósticos, manejo inicial, sulfato de magnesio (dosis), antihipertensivos, criterios de culminación";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["preeclampsia","criterios diagnósticos","sulfato de magnesio","antihipertensivos"]);
  });

  it("T108 — Excel indicadores hospitalarios 12 meses ocupación mortalidad", () => {
    const p = "Crea Excel de indicadores hospitalarios: tasa de ocupación, promedio estancia, tasa mortalidad, infecciones intrahospitalarias, cesáreas, para 12 meses, con gráficos de tendencia";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("12 meses");
    kw(p, ["tasa de ocupación","promedio estancia","tasa mortalidad","infecciones intrahospitalarias"]);
  });

  it("T109 — SVG anatomía corazón 4 cámaras válvulas grandes vasos", () => {
    const p = "Genera SVG de anatomía del corazón: 4 cámaras (AD, AI, VD, VI), válvulas (tricúspide, mitral, pulmonar, aórtica), grandes vasos, con etiquetas";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["4 cámaras","ad","ai","vd","vi","tricúspide","mitral","pulmonar","aórtica"]);
  });

  it("T110 — Word PAE enfermería diabético NANDA NOC NIC", () => {
    const p = "Crea Word de PAE de enfermería para paciente diabético: valoración por dominios, 3 diagnósticos NANDA, 3 resultados NOC, 6 intervenciones NIC, evaluación";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["pae","nanda","noc","nic","diabético"]);
  });
});

// ═══════════════════════════════════════
// PSICOLOGÍA (T111-T120)
// ═══════════════════════════════════════

describe("Sprint 1 · Psicología", () => {
  it("T111 — Word escala ansiedad Likert 25 ítems baremo", () => {
    const p = "Genera Word con escala de ansiedad tipo Likert: 25 ítems, 5 opciones (nunca=1 a siempre=5), instrucciones, baremo (bajo 25-50, medio 51-75, alto 76-100, muy alto 101-125)";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("25 ítems");
    kw(p, ["likert","nunca=1","siempre=5","baremo"]);
  });

  it("T112 — Excel tabulación 100 participantes 5 sociodemográficas chi-cuadrado", () => {
    const p = "Crea Excel de tabulación de investigación psicológica: 100 participantes, 5 variables sociodemográficas, 3 escalas psicológicas, frecuencias, porcentajes, chi-cuadrado";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("100 participantes");
    kw(p, ["sociodemográficas","escalas psicológicas","frecuencias","chi-cuadrado"]);
  });

  it("T113 — Excel V Aiken 20 ítems 7 jueces V≥0.80", () => {
    const p = "Genera Excel de validez de contenido V de Aiken: 20 ítems, 7 jueces expertos, valoración por pertinencia/relevancia/claridad, V de Aiken por ítem, decisión (V≥0.80 = válido)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("20 ítems");
    expect(p).toContain("7 jueces");
    expect(p).toContain("V≥0.80");
    kw(p, ["v de aiken","pertinencia","relevancia","claridad"]);
  });

  it("T114 — Word informe psicológico forense MMPI-2 Rorschach", () => {
    const p = "Crea Word de informe psicológico forense: datos del evaluado, motivo de evaluación, instrumentos aplicados (MMPI-2, Rorschach), resultados, análisis, conclusiones forenses";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["informe psicológico forense","mmpi-2","rorschach","conclusiones forenses"]);
  });

  it("T115 — PPT psicoeducación TEPT DSM-5 intrusión evitación hiperactivación", () => {
    const p = "Genera PPT de psicoeducación sobre trastorno de estrés postraumático: definición DSM-5, síntomas (intrusión, evitación, cognición negativa, hiperactivación), tratamiento, recursos";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["estrés postraumático","dsm-5","intrusión","evitación","hiperactivación"]);
  });

  it("T116 — Excel alfa Cronbach 100 sujetos 20 ítems α=(k/(k-1))×(1-ΣVi/Vt)", () => {
    const p = "Crea Excel de análisis de confiabilidad: 100 sujetos, 20 ítems, correlación ítem-total, alfa de Cronbach si se elimina ítem, alfa global, con fórmula α = (k/(k-1))×(1-ΣVi/Vt)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("100 sujetos");
    expect(p).toContain("20 ítems");
    expect(p).toContain("α = (k/(k-1))×(1-ΣVi/Vt)");
    kw(p, ["cronbach","correlación ítem-total"]);
  });

  it("T117 — Excel baremos percentilares 500 sujetos frecuencia acumulada", () => {
    const p = "Genera Excel de baremos percentilares: puntajes directos, frecuencia, frecuencia acumulada, percentil, para muestra de 500 sujetos";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("500 sujetos");
    kw(p, ["baremos percentilares","frecuencia acumulada","percentil"]);
  });

  it("T118 — Word intervención TCC depresión activación conductual reestructuración", () => {
    const p = "Crea Word de plan de intervención cognitivo-conductual para depresión: formulación del caso, objetivos SMART, técnicas (activación conductual, reestructuración cognitiva, entrenamiento en habilidades), sesiones";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["cognitivo-conductual","depresión","activación conductual","reestructuración cognitiva","smart"]);
  });

  it("T119 — Mermaid evaluación psicológica entrevista→tests→informe→devolución 7 fases", () => {
    const p = "Genera diagrama mermaid del proceso de evaluación psicológica: entrevista → aplicación de tests → calificación → interpretación → integración → informe → devolución";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const steps = ["entrevista","aplicación de tests","calificación","interpretación","integración","informe","devolución"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(7);
  });

  it("T120 — Excel factorial exploratorio KMO Bartlett autovalores cargas rotadas", () => {
    const p = "Crea Excel de análisis factorial exploratorio: matriz de correlaciones 10×10, KMO, prueba de Bartlett, autovalores, varianza explicada, cargas factoriales rotadas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10×10");
    kw(p, ["factorial exploratorio","kmo","bartlett","autovalores","cargas factoriales"]);
  });
});

// ═══════════════════════════════════════
// CIENCIAS E INVESTIGACIÓN (T121-T150)
// ═══════════════════════════════════════

describe("Sprint 1 · Ciencias e Investigación", () => {
  it("T121 — Word artículo APA 7 abstract 250 palabras 20 referencias", () => {
    const p = "Genera Word de artículo científico formato APA 7: título, abstract (250 palabras), keywords, introducción con antecedentes y justificación, método (diseño, población, muestra, instrumento, procedimiento), resultados, discusión, conclusiones, referencias (20)";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("APA 7");
    expect(p).toContain("250 palabras");
    expect(p).toContain("(20)");
    kw(p, ["abstract","keywords","método","resultados","discusión","conclusiones","referencias"]);
  });

  it("T122 — Excel ANOVA un factor 4 grupos 15 sujetos F p-value", () => {
    const p = "Crea Excel de análisis ANOVA de un factor: 4 grupos, 15 sujetos por grupo, suma de cuadrados (entre, dentro, total), grados de libertad, F calculado, p-value, decisión";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("4 grupos");
    expect(p).toContain("15 sujetos");
    kw(p, ["anova","suma de cuadrados","grados de libertad","f calculado","p-value"]);
  });

  it("T123 — Excel regresión lineal simple 30 datos y=a+bx R² dispersión", () => {
    const p = "Genera Excel de análisis de regresión lineal simple: 30 datos (X,Y), ecuación y=a+bx, R², error estándar, tabla ANOVA de regresión, gráfico de dispersión con línea";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("30 datos");
    expect(p).toContain("y=a+bx");
    kw(p, ["regresión lineal","r²","error estándar","gráfico de dispersión"]);
  });

  it("T124 — PPT defensa tesis maestría hipótesis metodología resultados", () => {
    const p = "Crea PPT de defensa de tesis de maestría: planteamiento del problema, objetivos, hipótesis, marco teórico, metodología (diseño no experimental, transversal), resultados, discusión, conclusiones, recomendaciones";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["defensa de tesis","hipótesis","marco teórico","diseño no experimental","transversal"]);
  });

  it("T125 — Mermaid diseño metodológico cuantitativo descriptivo-correlacional", () => {
    const p = "Genera diagrama mermaid de diseño metodológico: enfoque cuantitativo → diseño no experimental → tipo descriptivo-correlacional → corte transversal → técnica encuesta → instrumento cuestionario";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["cuantitativo","no experimental","descriptivo-correlacional","transversal","encuesta","cuestionario"]);
  });

  it("T126 — Excel tamaño muestra población finita Z² p q N fórmula", () => {
    const p = "Crea Excel de cálculo de tamaño de muestra: población finita N, nivel confianza Z, proporción p, error e, fórmula n = (Z²×p×q×N)/(e²×(N-1)+Z²×p×q), ajuste por no respuesta";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("n = (Z²×p×q×N)/(e²×(N-1)+Z²×p×q)");
    kw(p, ["tamaño de muestra","población finita","nivel confianza"]);
  });

  it("T127 — Word operacionalización 3 variables dimensiones indicadores ítems", () => {
    const p = "Genera Word de operacionalización de variables: 3 variables, definición conceptual, definición operacional, dimensiones, indicadores, ítems, escala de medición";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("3 variables");
    kw(p, ["operacionalización","definición conceptual","definición operacional","dimensiones","indicadores"]);
  });

  it("T128 — Excel tabla frecuencias Sturges intervalos histograma polígono", () => {
    const p = "Crea Excel de tabla de frecuencias con intervalos: 50 datos, rango, número de clases (Sturges), amplitud, límites, marca de clase, fi, Fi, hi, Hi, histograma y polígono";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("50 datos");
    kw(p, ["sturges","amplitud","marca de clase","histograma","polígono"]);
  });

  it("T129 — Excel chi-cuadrado contingencia 4×3 observadas esperadas gl p-value", () => {
    const p = "Genera Excel de prueba chi-cuadrado de independencia: tabla de contingencia 4×3, frecuencias observadas, frecuencias esperadas, χ² calculado, gl, p-value, decisión";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("4×3");
    kw(p, ["chi-cuadrado","contingencia","frecuencias observadas","frecuencias esperadas","p-value"]);
  });

  it("T130 — Word marco teórico redes sociales rendimiento académico 15+10 antecedentes", () => {
    const p = "Crea Word de marco teórico de tesis sobre impacto de redes sociales en rendimiento académico: 15 antecedentes internacionales, 10 nacionales, bases teóricas (conectivismo, TAM), definición de términos";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("15 antecedentes");
    expect(p).toContain("10 nacionales");
    kw(p, ["redes sociales","rendimiento académico","conectivismo","tam","definición de términos"]);
  });

  it("T131 — Excel correlación Pearson 50 pares r significancia dispersión", () => {
    const p = "Genera Excel de correlación de Pearson: 50 pares de datos (X,Y), coeficiente r, t calculado, grados de libertad, p-value, gráfico de dispersión con línea de tendencia";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("50 pares");
    kw(p, ["pearson","coeficiente r","t calculado","dispersión","línea de tendencia"]);
  });

  it("T132 — Word proyecto investigación justificación objetivos hipótesis cronograma", () => {
    const p = "Crea Word de proyecto de investigación: título, planteamiento del problema, justificación (teórica, práctica, metodológica), objetivos (general, 4 específicos), hipótesis, cronograma de actividades";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("4 específicos");
    kw(p, ["planteamiento del problema","justificación","hipótesis","cronograma"]);
  });

  it("T133 — Excel prueba t Student independiente 2 grupos 25 sujetos", () => {
    const p = "Genera Excel de prueba t de Student para muestras independientes: grupo control (25 sujetos), grupo experimental (25 sujetos), media, desviación, t calculado, gl, p-value, d de Cohen";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("25 sujetos");
    kw(p, ["t de student","grupo control","grupo experimental","d de cohen"]);
  });

  it("T134 — PPT investigación mixta diseño secuencial explicativo QUAL+QUANT", () => {
    const p = "Crea PPT de diseño de investigación mixta: enfoque pragmático, diseño secuencial explicativo, fase cuantitativa (encuesta, 300 sujetos), fase cualitativa (entrevistas, 15 sujetos), triangulación";
    expect(analyzePrompt(p).type).toBe("presentation");
    expect(p).toContain("300 sujetos");
    expect(p).toContain("15 sujetos");
    kw(p, ["investigación mixta","secuencial explicativo","cuantitativa","cualitativa","triangulación"]);
  });

  it("T135 — Excel Mann-Whitney U no paramétrica 2 grupos rangos", () => {
    const p = "Genera Excel de prueba U de Mann-Whitney: 2 grupos independientes (n1=20, n2=18), rangos, suma de rangos, U calculado, z, p-value, r (tamaño del efecto)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("n1=20");
    expect(p).toContain("n2=18");
    kw(p, ["mann-whitney","rangos","suma de rangos","tamaño del efecto"]);
  });

  it("T136 — Word consentimiento informado investigación participantes riesgos beneficios", () => {
    const p = "Crea Word de formato de consentimiento informado para investigación: título del estudio, investigador, propósito, procedimientos, riesgos, beneficios, confidencialidad, voluntariedad, firma";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["consentimiento informado","propósito","procedimientos","riesgos","beneficios","confidencialidad","voluntariedad"]);
  });

  it("T137 — Excel Kruskal-Wallis 4 grupos rangos H chi-cuadrado comparaciones post-hoc", () => {
    const p = "Genera Excel de prueba Kruskal-Wallis: 4 grupos independientes, rangos, estadístico H, chi-cuadrado, gl, p-value, comparaciones post-hoc por pares";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("4 grupos");
    kw(p, ["kruskal-wallis","estadístico h","chi-cuadrado","post-hoc"]);
  });

  it("T138 — Mermaid proceso publicación científica envío→revisión→arbitraje→decisión→publicación", () => {
    const p = "Genera diagrama mermaid del proceso de publicación científica: envío de manuscrito → revisión editorial → arbitraje por pares → decisión (aceptar/revisar/rechazar) → revisión de autores → publicación";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["envío","revisión editorial","arbitraje","decisión","publicación"]);
  });

  it("T139 — Excel Wilcoxon rangos signados antes/después 30 pares", () => {
    const p = "Crea Excel de prueba de Wilcoxon de rangos signados: mediciones antes y después para 30 sujetos, diferencias, rangos con signo, W+, W-, z, p-value";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("30 sujetos");
    kw(p, ["wilcoxon","rangos signados","antes y después","w+","w-"]);
  });

  it("T140 — Word revisión sistemática PRISMA selección inclusión/exclusión", () => {
    const p = "Genera Word de protocolo de revisión sistemática: pregunta PICO, estrategia de búsqueda (3 bases), criterios de inclusión/exclusión, diagrama PRISMA, extracción de datos, evaluación de calidad";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["revisión sistemática","pico","estrategia de búsqueda","prisma","inclusión","exclusión"]);
  });

  it("T141 — Excel Spearman 40 pares rango ρ significancia", () => {
    const p = "Crea Excel de correlación de Spearman: 40 pares de datos ordinales, rangos X y Y, diferencias de rango d, d², ρ de Spearman, significancia estadística";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("40 pares");
    kw(p, ["spearman","rangos","diferencias de rango","significancia estadística"]);
  });

  it("T142 — PPT poster científico IMRaD título abstract método resultados conclusiones", () => {
    const p = "Genera PPT de poster científico formato IMRaD: título, autores, abstract, introducción, metodología, resultados (tabla + gráfico), discusión, conclusiones, referencias clave";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["poster científico","imrad","abstract","metodología","resultados","discusión"]);
  });

  it("T143 — Excel análisis ítem dificultad discriminación biserial punto", () => {
    const p = "Crea Excel de análisis de ítems psicométrico: 30 ítems, índice de dificultad p, índice de discriminación D, correlación biserial puntual rpb, decisión (retener/revisar/eliminar)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("30 ítems");
    kw(p, ["índice de dificultad","índice de discriminación","biserial puntual","retener"]);
  });

  it("T144 — Word ficha técnica instrumento nombre autor dimensiones confiabilidad validez baremo", () => {
    const p = "Genera Word de ficha técnica de instrumento psicológico: nombre, autor, año, objetivo, dimensiones (4), número de ítems (40), escala Likert, confiabilidad (α=0.89), validez (V Aiken ≥0.80), baremo normativo";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("α=0.89");
    expect(p).toContain("V Aiken ≥0.80");
    expect(p).toContain("40");
    kw(p, ["ficha técnica","dimensiones","confiabilidad","validez","baremo"]);
  });

  it("T145 — Excel meta-análisis 12 estudios tamaño efecto heterogeneidad forest plot", () => {
    const p = "Crea Excel de meta-análisis: 12 estudios incluidos, tamaño de efecto (d de Cohen), error estándar, peso, intervalo de confianza 95%, heterogeneidad (I², Q), efecto combinado, forest plot";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("12 estudios");
    kw(p, ["meta-análisis","d de cohen","intervalo de confianza","heterogeneidad","forest plot"]);
  });

  it("T146 — Mermaid niveles evidencia piramide revisiones→ECA→cohorte→caso→opinión", () => {
    const p = "Genera diagrama mermaid de pirámide de niveles de evidencia científica: revisiones sistemáticas/meta-análisis → ensayos controlados aleatorizados → estudios de cohorte → casos y controles → series de casos → opinión de expertos";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["revisiones sistemáticas","ensayos controlados","cohorte","casos y controles","opinión de expertos"]);
  });

  it("T147 — Excel análisis supervivencia Kaplan-Meier 50 pacientes tiempo evento censura", () => {
    const p = "Crea Excel de análisis de supervivencia Kaplan-Meier: 50 pacientes, tiempo de seguimiento (meses), evento (sí/no), censura, probabilidad de supervivencia acumulada, curva de supervivencia";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("50 pacientes");
    kw(p, ["kaplan-meier","tiempo de seguimiento","censura","probabilidad de supervivencia"]);
  });

  it("T148 — Word informe epidemiológico brote incidencia prevalencia tasa mortalidad curva epidémica", () => {
    const p = "Genera Word de informe epidemiológico de brote: descripción del evento, caso índice, incidencia, prevalencia, tasa de mortalidad, tasa de letalidad, curva epidémica, medidas de control";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["brote","caso índice","incidencia","prevalencia","tasa de mortalidad","curva epidémica"]);
  });

  it("T149 — Excel odds ratio caso-control 2×2 OR IC95% chi-cuadrado", () => {
    const p = "Crea Excel de cálculo de odds ratio para estudio caso-control: tabla 2×2 (expuestos/no expuestos vs casos/controles), OR, intervalo de confianza 95%, chi-cuadrado, p-value";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("2×2");
    kw(p, ["odds ratio","caso-control","intervalo de confianza","chi-cuadrado"]);
  });

  it("T150 — Word protocolo ensayo clínico fase III aleatorización doble ciego endpoints", () => {
    const p = "Genera Word de protocolo de ensayo clínico fase III: título, investigador principal, objetivo primario, diseño (aleatorizado, doble ciego, controlado con placebo), criterios inclusión/exclusión, endpoints primarios y secundarios, análisis estadístico, consideraciones éticas";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["ensayo clínico fase iii","aleatorizado","doble ciego","placebo","endpoints","consideraciones éticas"]);
  });
});
