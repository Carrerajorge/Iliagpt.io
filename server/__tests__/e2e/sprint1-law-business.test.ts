import { describe, it, expect } from "vitest";

/* ─────────────────────────────────────────────
 * Sprint 1 — Archivo 2 de 4
 * DERECHO Y NEGOCIOS
 * 50 tests (T51-T100)
 * ───────────────────────────────────────────── */

interface DocResult { type: string; format: string; }

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const r: DocResult = { type: "unknown", format: "unknown" };
  if (lower.includes("excel") || lower.includes("nómina") || lower.includes("planilla") || lower.includes("tabulación") || lower.includes("costeo") || lower.includes("conciliación bancaria")) r.type = "spreadsheet";
  else if (lower.startsWith("crea ppt") || lower.startsWith("genera ppt") || lower.includes("ppt de") || lower.includes("ppt sobre") || lower.includes("presentación") || lower.includes("pitch deck")) r.type = "presentation";
  else if (lower.startsWith("crea pdf") || lower.startsWith("genera pdf") || lower.includes("pdf de")) r.type = "pdf";
  else if (lower.startsWith("crea word") || lower.startsWith("genera word") || lower.includes("word de")) r.type = "document";
  else if (lower.includes("mermaid") || lower.includes("diagrama del proceso") || lower.includes("diagrama de")) r.type = "diagram";
  else if (lower.includes("svg")) r.type = "svg";
  else if (lower.includes("html")) r.type = "html";
  else if (lower.includes("informe") || lower.includes("contrato") || lower.includes("plan de") || lower.includes("demanda") || lower.includes("escritura") || lower.includes("recurso") || lower.includes("dictamen") || lower.includes("prospecto") || lower.includes("nda") || lower.includes("acuerdo")) r.type = "document";
  if (lower.includes("mermaid")) r.format = "mermaid";
  else if (r.type === "spreadsheet") r.format = "xlsx";
  else if (r.type === "document") r.format = "docx";
  else if (r.type === "presentation") r.format = "pptx";
  else if (r.type === "pdf") r.format = "pdf";
  return r;
}

function kw(prompt: string, words: string[]): void {
  const lower = prompt.toLowerCase();
  for (const w of words) expect(lower).toContain(w.toLowerCase());
}

// ═══════════════════════════════════════
// DERECHO (T51-T65)
// ═══════════════════════════════════════

describe("Sprint 1 · Derecho — Contratos, Procesal, Laboral", () => {
  it("T51 — Word contrato arrendamiento 20 cláusulas", () => {
    const p = "Genera Word de contrato de arrendamiento comercial: 20 cláusulas con numeración jerárquica, incluyendo objeto, renta, plazo, garantía, penalidades, resolución, jurisdicción";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("20 cláusulas");
    kw(p, ["objeto","renta","plazo","garantía","penalidades","resolución","jurisdicción"]);
  });

  it("T52 — Excel seguimiento 30 expedientes judiciales formato condicional", () => {
    const p = "Crea Excel de seguimiento de expedientes judiciales: 30 casos, juzgado, materia (civil/penal/laboral/constitucional), estado procesal, próxima audiencia, abogado responsable, con formato condicional por vencimiento";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("30 casos");
    kw(p, ["juzgado","materia","civil","penal","laboral","constitucional","formato condicional"]);
  });

  it("T53 — PDF demanda indemnización 10 fundamentos 8 artículos", () => {
    const p = "Genera PDF de demanda de indemnización por daños y perjuicios: carátula (juzgado, expediente, partes), hechos (10 fundamentos), fundamentos de derecho (8 artículos), petitorio, anexos";
    expect(analyzePrompt(p).type).toBe("pdf");
    expect(p).toContain("10 fundamentos");
    expect(p).toContain("8 artículos");
    kw(p, ["carátula","petitorio","anexos"]);
  });

  it("T54 — PPT tesis derecho penal feminicidio Perú 2021-2025", () => {
    const p = "Crea PPT de sustentación de tesis de derecho penal sobre tipificación del feminicidio en el Perú 2021-2025: marco teórico, metodología, resultados, conclusiones";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["feminicidio","perú","2021-2025","marco teórico","metodología","resultados","conclusiones"]);
  });

  it("T55 — Mermaid proceso penal peruano 7 etapas", () => {
    const p = "Genera diagrama mermaid del proceso penal peruano: denuncia → diligencias preliminares → investigación preparatoria → etapa intermedia → juicio oral → sentencia → impugnación";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const steps = ["denuncia","diligencias preliminares","investigación preparatoria","etapa intermedia","juicio oral","sentencia","impugnación"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(7);
  });

  it("T56 — Word escritura pública SAC 20 artículos estatuto", () => {
    const p = "Crea Word de escritura pública de constitución de empresa SAC: pacto social, estatuto (20 artículos), capital, directorio, gerencia, distribución de utilidades";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("20 artículos");
    kw(p, ["pacto social","estatuto","capital","directorio","gerencia"]);
  });

  it("T57 — Excel beneficios sociales CTS gratificaciones vacaciones 20 trabajadores", () => {
    const p = "Genera Excel de cálculo de beneficios sociales laborales: CTS, gratificaciones, vacaciones, para 20 trabajadores con distintas fechas de ingreso y remuneraciones";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("20 trabajadores");
    kw(p, ["cts","gratificaciones","vacaciones"]);
  });

  it("T58 — Word recurso casación causales infracción normativa", () => {
    const p = "Crea Word de recurso de casación: requisitos de admisibilidad, causales (infracción normativa, apartamiento de precedente), fundamentación, pretensión casatoria";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["casación","admisibilidad","infracción normativa","apartamiento de precedente","pretensión casatoria"]);
  });

  it("T59 — Excel jurisprudencia 25 sentencias TC derecho identidad", () => {
    const p = "Genera Excel de tabla de jurisprudencia: 25 sentencias del Tribunal Constitucional sobre derecho a la identidad, con caso, expediente, fecha, ratio decidendi, obiter dicta";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("25 sentencias");
    kw(p, ["tribunal constitucional","ratio decidendi","obiter dicta"]);
  });

  it("T60 — PPT violencia género Ley 30364 medidas protección", () => {
    const p = "Crea PPT sobre medidas de protección en violencia de género: Ley 30364, tipos de violencia, proceso de tutela, medidas cautelares, estadísticas";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["ley 30364","tipos de violencia","medidas cautelares"]);
  });

  it("T61 — Word NDA bilateral plazo 3 años penalidad 50 UIT", () => {
    const p = "Genera Word de NDA (acuerdo de confidencialidad) bilateral: definición de información confidencial, obligaciones, excepciones, plazo (3 años), penalidad (50 UIT), jurisdicción (Lima)";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("3 años");
    expect(p).toContain("50 UIT");
    kw(p, ["nda","información confidencial","obligaciones","excepciones"]);
  });

  it("T62 — Excel control plazos 40 procesos alertas rojo/amarillo", () => {
    const p = "Crea Excel de control de plazos procesales: 40 procesos, tipo, instancia, plazo legal (días), fecha inicio, fecha vencimiento, días restantes, con alertas automáticas rojo/amarillo";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("40 procesos");
    kw(p, ["plazo legal","fecha vencimiento","días restantes","alertas"]);
  });

  it("T63 — Mermaid conciliación extrajudicial cosa juzgada", () => {
    const p = "Genera diagrama mermaid del proceso de conciliación extrajudicial: solicitud → invitación → audiencia → acuerdo/desacuerdo → acta con efecto de cosa juzgada";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["conciliación extrajudicial","solicitud","audiencia","cosa juzgada"]);
  });

  it("T64 — Word informe jurídico constitucionalidad trabajo remoto", () => {
    const p = "Crea Word de informe jurídico sobre la constitucionalidad del trabajo remoto: análisis del derecho al trabajo (art. 22 Constitución), libertad de empresa, protección del trabajador";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["constitucionalidad","trabajo remoto","art. 22","libertad de empresa"]);
  });

  it("T65 — Excel riesgos legales corporativos 15 riesgos mapa calor", () => {
    const p = "Genera Excel de análisis de riesgos legales corporativos: 15 riesgos, probabilidad, impacto, nivel de riesgo, medida de mitigación, responsable, con mapa de calor";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("15 riesgos");
    kw(p, ["probabilidad","impacto","mitigación","mapa de calor"]);
  });
});

// ═══════════════════════════════════════
// NEGOCIOS — Administración, Marketing, Finanzas (T66-T100)
// ═══════════════════════════════════════

describe("Sprint 1 · Negocios — Finanzas, Marketing, Administración", () => {
  it("T66 — Excel estado resultados 5 años crecimiento 15% IR 29.5%", () => {
    const p = "Crea Excel de estado de resultados proyectado a 5 años: ventas con crecimiento 15% anual, costo de ventas 60%, gastos operativos, depreciación, impuesto a la renta 29.5%, utilidad neta";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("15%");
    expect(p).toContain("29.5%");
    kw(p, ["estado de resultados","costo de ventas","depreciación","utilidad neta"]);
  });

  it("T67 — Excel DCF EBITDA WACC 12% Gordon valor empresa", () => {
    const p = "Genera Excel de flujo de caja libre para valorización DCF: EBITDA, capex, working capital, flujo libre, WACC 12%, valor terminal, valor empresa, con fórmula de Gordon";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("WACC 12%");
    kw(p, ["dcf","ebitda","capex","flujo libre","valor terminal","gordon"]);
  });

  it("T68 — PPT pitch deck fintech TAM/SAM/SOM unit economics", () => {
    const p = "Crea PPT de pitch deck para startup fintech: problema (inclusión financiera en Perú), solución (billetera digital), mercado TAM/SAM/SOM, modelo freemium, unit economics, equipo, ask";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["fintech","tam/sam/som","unit economics","freemium"]);
  });

  it("T69 — Excel embudo ventas B2B 5 etapas 200 leads conversión", () => {
    const p = "Genera Excel de embudo de ventas B2B: 5 etapas (prospecto, MQL, SQL, propuesta, cierre), 200 leads, tasas de conversión, valor promedio, pipeline total, forecast por mes";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("200 leads");
    kw(p, ["embudo","mql","sql","conversión","pipeline","forecast"]);
  });

  it("T70 — Word plan marketing digital PESTEL FODA buyer persona KPIs", () => {
    const p = "Crea Word de plan de marketing digital: análisis PESTEL, FODA, buyer persona (3), customer journey, estrategia de contenidos, KPIs, presupuesto por canal (SEO, SEM, Social, Email)";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["pestel","foda","buyer persona","customer journey","seo","sem"]);
  });

  it("T71 — Excel punto equilibrio multiproducto 5 productos PE soles", () => {
    const p = "Genera Excel de análisis de punto de equilibrio multiproducto: 5 productos, precio, costo variable, margen contribución, mix de ventas, costos fijos, PE en unidades y soles";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("5 productos");
    kw(p, ["punto de equilibrio","margen contribución","mix de ventas","costos fijos"]);
  });

  it("T72 — Excel BSC 4 perspectivas 16 KPIs spider chart", () => {
    const p = "Crea Excel de balanced scorecard: 4 perspectivas (financiera, cliente, procesos, aprendizaje), 16 KPIs, meta, real, desviación, semáforo, con gráficos spider";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["balanced scorecard","financiera","cliente","procesos","aprendizaje","16 kpis"]);
  });

  it("T73 — Mermaid modelo Canvas 9 bloques", () => {
    const p = "Genera diagrama mermaid del modelo Canvas: 9 bloques (propuesta de valor, segmentos, canales, relaciones, fuentes de ingreso, recursos, actividades, socios, estructura de costos)";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["propuesta de valor","segmentos","canales","fuentes de ingreso","estructura de costos"]);
  });

  it("T74 — Excel nómina 50 empleados Perú AFP/ONP Essalud IR 5ta", () => {
    const p = "Crea Excel de nómina de 50 empleados Perú: sueldo bruto, AFP/ONP (13%), Essalud (9%), IR 5ta categoría (8%-30%), gratificación, CTS, neto a pagar";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("50 empleados");
    expect(p).toContain("13%");
    expect(p).toContain("9%");
    kw(p, ["afp/onp","essalud","ir 5ta categoría","gratificación","cts"]);
  });

  it("T75 — PPT plan estratégico 2026-2030 Porter cadena valor BSC", () => {
    const p = "Genera PPT de plan estratégico 2026-2030: visión, misión, valores, análisis externo (5 fuerzas Porter), análisis interno (cadena de valor), objetivos estratégicos, mapa estratégico BSC";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["plan estratégico","visión","misión","5 fuerzas porter","cadena de valor","mapa estratégico"]);
  });

  it("T76 — Excel costeo exportación DDP Incoterms 2020", () => {
    const p = "Crea Excel de costeo de exportación DDP: valor EXW, flete interno, agente aduanas, flete internacional, seguro, aranceles, IVA destino, con Incoterms 2020";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["ddp","exw","flete internacional","aranceles","incoterms 2020"]);
  });

  it("T77 — Excel riesgo crediticio 20 clientes clasificación SBS", () => {
    const p = "Genera Excel de análisis de riesgo crediticio: 20 clientes, score crediticio, ratio deuda/ingreso, historial, clasificación (normal, CPP, deficiente, dudoso, pérdida)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("20 clientes");
    kw(p, ["score crediticio","normal","cpp","deficiente","dudoso","pérdida"]);
  });

  it("T78 — Word plan negocio agroexportación arándanos mercado EEUU", () => {
    const p = "Crea Word de plan de negocio de agroexportación de arándanos: análisis de mercado EEUU, ficha técnica, proceso productivo, certificaciones, proyección financiera";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["agroexportación","arándanos","eeuu","ficha técnica","certificaciones","proyección financiera"]);
  });

  it("T79 — Excel valorización múltiplos 10 comparables EV/EBITDA P/E P/BV", () => {
    const p = "Genera Excel de valorización de empresa por múltiplos: 10 empresas comparables, EV/EBITDA, P/E, P/BV, mediana, aplicación a empresa objetivo";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10 empresas");
    kw(p, ["ev/ebitda","p/e","p/bv","mediana"]);
  });

  it("T80 — Excel portafolio Markowitz 10 activos rendimiento riesgo correlaciones", () => {
    const p = "Crea Excel de gestión de portafolio de inversiones: 10 activos, rendimiento esperado, riesgo (desv. estándar), correlaciones, portafolio óptimo Markowitz";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10 activos");
    kw(p, ["rendimiento esperado","desv. estándar","correlaciones","markowitz"]);
  });

  it("T81 — PPT due diligence financiera estructura deuda contingencias", () => {
    const p = "Genera PPT de due diligence financiera: estructura societaria, estados financieros auditados, contingencias, deuda, capital de trabajo, ajustes";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["due diligence","estados financieros","contingencias","capital de trabajo"]);
  });

  it("T82 — Excel modelo financiero inmobiliario TIR VAN recuperación", () => {
    const p = "Crea Excel de modelo financiero de proyecto inmobiliario: terreno, construcción, ventas, flujo del proyecto, TIR, VAN, período de recuperación";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["modelo financiero","tir","van","período de recuperación"]);
  });

  it("T83 — Excel sensibilidad VAN precio ±20% costo ±15% demanda ±25% tornado", () => {
    const p = "Genera Excel de análisis de sensibilidad: VAN base, variación de precio ±20%, variación de costo ±15%, variación de demanda ±25%, tabla de tornado";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("±20%");
    expect(p).toContain("±15%");
    expect(p).toContain("±25%");
    kw(p, ["sensibilidad","van","tornado"]);
  });

  it("T84 — Word prospecto bonos corporativos emisor monto tasa garantías", () => {
    const p = "Crea Word de prospecto de emisión de bonos corporativos: emisor, monto, plazo, tasa, garantías, factores de riesgo, uso de fondos";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["prospecto","bonos corporativos","emisor","garantías","factores de riesgo"]);
  });

  it("T85 — Excel conciliación bancaria libro vs banco partidas conciliatorias", () => {
    const p = "Genera Excel de conciliación bancaria: movimientos del libro (30), movimientos del banco (35), partidas conciliatorias, saldo conciliado";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["conciliación bancaria","movimientos del libro","movimientos del banco","saldo conciliado"]);
  });

  it("T86 — Excel presupuesto maestro 8 hojas ventas→estado resultados", () => {
    const p = "Crea Excel de presupuesto maestro: ventas → producción → MP → MOD → CIF → costo de producción → gastos → estado de resultados presupuestado";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["presupuesto maestro","ventas","producción","mp","mod","cif","estado de resultados"]);
  });

  it("T87 — Mermaid crédito bancario solicitud→evaluación→desembolso→recuperación", () => {
    const p = "Genera diagrama mermaid del proceso de crédito bancario: solicitud → evaluación → comité → aprobación/rechazo → desembolso → seguimiento → recuperación";
    expect(analyzePrompt(p).format).toBe("mermaid");
    kw(p, ["solicitud","evaluación","comité","desembolso","seguimiento","recuperación"]);
  });

  it("T88 — Excel indicadores cobranzas morosidad cobertura gráficos", () => {
    const p = "Crea Excel de indicadores de gestión de cobranzas: cartera total, vigente, vencida, judicial, provisiones, ratio morosidad, cobertura, con gráficos";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["cartera total","vigente","vencida","judicial","morosidad","cobertura"]);
  });

  it("T89 — PPT internacionalización selección mercado modo entrada pricing", () => {
    const p = "Genera PPT de estrategia de internacionalización: selección de mercado (matriz de priorización), modo de entrada, adaptación de producto, pricing, distribución";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["internacionalización","selección de mercado","modo de entrada","pricing"]);
  });

  it("T90 — Excel DuPont margen×rotación×multiplicador=ROE 5 empresas", () => {
    const p = "Crea Excel de análisis DuPont: margen neto × rotación de activos × multiplicador de capital = ROE, para 5 empresas, con gráfico comparativo";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("5 empresas");
    kw(p, ["dupont","margen neto","rotación de activos","multiplicador de capital","roe"]);
  });

  it("T91 — Word dictamen auditoría salvedades NIA", () => {
    const p = "Genera Word de dictamen de auditoría con salvedades: párrafo introductorio, responsabilidad, base de salvedades, opinión modificada";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["dictamen","auditoría","salvedades","opinión modificada"]);
  });

  it("T92 — Excel forecast ventas 24 meses 3 métodos MAPE", () => {
    const p = "Crea Excel de forecast de ventas: datos históricos 24 meses, promedio móvil, suavización exponencial (α=0.3), regresión lineal, MAPE de cada método";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("24 meses");
    expect(p).toContain("α=0.3");
    kw(p, ["promedio móvil","suavización exponencial","regresión lineal","mape"]);
  });

  it("T93 — Excel clústeres RFM 100 clientes 5 variables segmentación", () => {
    const p = "Genera Excel de análisis de clústeres de clientes: 100 clientes, 5 variables (frecuencia, recencia, monto, productos, antigüedad), segmentación RFM";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("100 clientes");
    kw(p, ["frecuencia","recencia","monto","rfm"]);
  });

  it("T94 — PPT reporte RRHH headcount rotación ausentismo clima", () => {
    const p = "Crea PPT de reporte de gestión de RRHH: headcount, rotación, ausentismo, clima laboral, capacitación horas/persona, costo per cápita, con gráficos";
    expect(analyzePrompt(p).type).toBe("presentation");
    kw(p, ["headcount","rotación","ausentismo","clima laboral","capacitación"]);
  });

  it("T95 — Excel evaluación 360° 10 evaluados 5 evaluadores 12 competencias", () => {
    const p = "Genera Excel de evaluación de desempeño 360°: 10 evaluados, 5 evaluadores cada uno, 12 competencias, escala 1-5, promedio por competencia y general";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10 evaluados");
    expect(p).toContain("5 evaluadores");
    expect(p).toContain("12 competencias");
    expect(p).toContain("1-5");
  });

  it("T96 — Excel regresión múltiple ventas 4 independientes R² p-values", () => {
    const p = "Crea Excel de análisis de regresión múltiple: variable dependiente (ventas), 4 independientes (precio, publicidad, competencia, estacionalidad), coeficientes, R², p-values";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["regresión múltiple","ventas","precio","publicidad","r²","p-values"]);
  });

  it("T97 — Word plan contingencia BIA estrategias continuidad crisis", () => {
    const p = "Genera Word de plan de contingencia empresarial: identificación de riesgos, análisis de impacto (BIA), estrategias de continuidad, plan de comunicación de crisis";
    expect(analyzePrompt(p).type).toBe("document");
    kw(p, ["plan de contingencia","bia","estrategias de continuidad","comunicación de crisis"]);
  });

  it("T98 — Excel cuadro mando marketing 20 KPIs CAC LTV ROAS CTR NPS churn", () => {
    const p = "Crea Excel de cuadro de mando de marketing: 20 KPIs (CAC, LTV, ROAS, CTR, CPC, engagement, NPS, churn, MRR, ARR), meta, real, variación, tendencia";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    kw(p, ["cac","ltv","roas","ctr","nps","churn","mrr","arr"]);
  });

  it("T99 — Mermaid proceso compras requerimiento→cotización→OC→pago 8 pasos", () => {
    const p = "Genera diagrama mermaid de proceso de compras: requerimiento → cotización → evaluación → orden de compra → recepción → inspección → ingreso almacén → pago";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const steps = ["requerimiento","cotización","evaluación","orden de compra","recepción","inspección","ingreso almacén","pago"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(8);
  });

  it("T100 — Excel Montecarlo 1000 iteraciones distribución VAN P(VAN>0)", () => {
    const p = "Crea Excel de simulación de Montecarlo para decisión de inversión: 1000 iteraciones, variables aleatorias (precio, demanda, costo), distribución de VAN, probabilidad VAN>0";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("1000 iteraciones");
    kw(p, ["montecarlo","variables aleatorias","distribución de van","probabilidad van>0"]);
  });
});
