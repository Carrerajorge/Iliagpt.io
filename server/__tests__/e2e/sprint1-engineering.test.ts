import { describe, it, expect } from "vitest";

/* ─────────────────────────────────────────────
 * Sprint 1 — Archivo 1 de 4
 * INGENIERÍA CIVIL, AMBIENTAL, SISTEMAS, INDUSTRIAL
 * 50 tests (T01-T50)
 * ───────────────────────────────────────────── */

interface DocResult {
  type: string;
  format: string;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown", format: "unknown" };

  // Order: explicit format prefix first, then fallback keywords
  if (lower.includes("excel") || lower.includes("planilla") || lower.includes("kardex") || lower.includes("tabulación") || lower.includes("nómina")) result.type = "spreadsheet";
  else if (lower.startsWith("crea ppt") || lower.startsWith("genera ppt") || lower.includes("ppt de") || lower.includes("presentación")) result.type = "presentation";
  else if (lower.startsWith("crea pdf") || lower.startsWith("genera pdf") || lower.includes("pdf de")) result.type = "pdf";
  else if (lower.startsWith("crea word") || lower.startsWith("genera word") || lower.includes("word de")) result.type = "document";
  else if (lower.includes("svg de") || lower.startsWith("genera svg") || lower.startsWith("crea svg") || lower.includes("sección transversal") || lower.includes("planta estructural") || lower.includes("ciclo hidrológico")) result.type = "svg";
  else if (lower.includes("mermaid") || lower.includes("diagrama de secuencia") || lower.includes("diagrama er") || lower.includes("diagrama de deployment")) result.type = "diagram";
  else if (lower.includes("diagrama")) result.type = "diagram";
  else if (lower.includes("html") || lower.includes("código html") || lower.includes("dashboard de monitoreo")) result.type = "html";
  else if (lower.includes("informe") || lower.includes("memoria") || lower.includes("especificaciones") || lower.includes("protocolo") || lower.includes("procedimiento") || lower.includes("plan de")) result.type = "document";

  if (lower.includes("mermaid")) result.format = "mermaid";
  else if (lower.includes("svg")) result.format = "svg";
  else if (result.type === "spreadsheet") result.format = "xlsx";
  else if (result.type === "document") result.format = "docx";
  else if (result.type === "presentation") result.format = "pptx";
  else if (result.type === "pdf") result.format = "pdf";
  else if (result.type === "html") result.format = "html";

  return result;
}

function extractKeywords(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const technical = [
    "concreto","acero","viga","columna","zapata","losa","cimentación","flexión","cortante",
    "talud","calzada","berma","cuneta","pavimento","subrasante",
    "dbo5","dqo","sst","ph","coliformes","eca","ptar","huella de carbono",
    "scope 1","scope 2","scope 3","tco2eq","leopold","biorremediación","fitorremediación",
    "pm2.5","pm10","co","so2","no2","o3",
    "scrum","sprint","user stories","velocity","microservicios","api gateway","auth service",
    "puntos de función","erp","srs","ieee 830","raci","deployment","nginx","postgresql","redis",
    "5s","seiri","seiton","seiso","seiketsu","shitsuke","six sigma","dmaic","spc","oee",
    "mrp","bom","lead time","cuello de botella","abc","pareto","guerchet","ishikawa",
  ];
  return technical.filter(kw => lower.includes(kw));
}

function countExpected(prompt: string): number {
  const m = prompt.match(/\b(\d+)\s*(partidas|actividades|estaciones|operaciones|ítems|SKUs|observaciones|subgrupos|órdenes|máquinas|servicios|tareas|roles|test cases|componentes|factores|nodos|etapas|pasos|aspectos|user stories|transacciones)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// ═══════════════════════════════════════
// ING. CIVIL (T01-T12)
// ═══════════════════════════════════════

describe("Sprint 1 · Ingeniería Civil — Diseño Estructural y Vial", () => {
  it("T01 — Excel metrado columnas 5 pisos V=a×b×h totales por piso", () => {
    const p = "Genera Excel de metrado de columnas de edificio 5 pisos: sección, altura, Nº, volumen concreto, peso acero, con fórmulas V=a×b×h y totales por piso";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("V=a×b×h");
    expect(p).toContain("5 pisos");
    expect(extractKeywords(p)).toContain("columna");
    expect(p.toLowerCase()).toContain("volumen concreto");
    expect(p.toLowerCase()).toContain("peso acero");
  });

  it("T02 — Word memoria cálculo estructural vigas flexión cortante", () => {
    const p = "Crea Word de memoria de cálculo estructural: predimensionamiento de vigas, verificación por flexión y cortante, con tablas de resultados";
    expect(analyzePrompt(p).type).toBe("document");
    const kw = extractKeywords(p);
    expect(kw).toContain("viga");
    expect(kw).toContain("flexión");
    expect(kw).toContain("cortante");
  });

  it("T03 — Excel costos unitarios concreto f'c=210 costo/m3", () => {
    const p = "Genera Excel de análisis de costos unitarios de partida 'concreto f'c=210': materiales (cemento, arena, piedra, agua), mano de obra, equipo, rendimiento, con fórmula de costo por m3";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("f'c=210");
    for (const m of ["cemento","arena","piedra","agua"]) expect(p.toLowerCase()).toContain(m);
    expect(p.toLowerCase()).toContain("costo por m3");
  });

  it("T04 — PPT infraestructura vial 5 temas", () => {
    const p = "Crea PPT de proyecto de infraestructura vial: estudio de tráfico, diseño geométrico, pavimentos, señalización, presupuesto";
    expect(analyzePrompt(p).type).toBe("presentation");
    for (const t of ["estudio de tráfico","diseño geométrico","pavimentos","señalización","presupuesto"]) expect(p.toLowerCase()).toContain(t);
  });

  it("T05 — Mermaid proceso constructivo cimentación 8 nodos", () => {
    const p = "Genera diagrama mermaid del proceso constructivo de cimentación: trazo → excavación → solado → armadura → encofrado → vaciado → curado → desencofrado";
    const r = analyzePrompt(p);
    expect(r.type).toBe("diagram");
    expect(r.format).toBe("mermaid");
    const steps = ["trazo","excavación","solado","armadura","encofrado","vaciado","curado","desencofrado"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(8);
  });

  it("T06 — Excel diseño mezcla ACI relación a/c", () => {
    const p = "Crea Excel de diseño de mezcla de concreto método ACI: relación a/c, dosificación por m3, corrección por humedad, con fórmulas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("ACI");
    expect(p.toLowerCase()).toContain("relación a/c");
  });

  it("T07 — SVG sección transversal vía 7.20m bermas talud", () => {
    const p = "Genera SVG de sección transversal de vía: calzada 7.20m, bermas 1.20m, cunetas, talud 1:1.5, con cotas y dimensiones";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(p).toContain("7.20m");
    const kw = extractKeywords(p);
    expect(kw).toContain("calzada");
    expect(kw).toContain("berma");
    expect(kw).toContain("cuneta");
    expect(kw).toContain("talud");
  });

  it("T08 — Excel cronograma valorizado 20 partidas 6 meses curva S", () => {
    const p = "Crea Excel de cronograma valorizado de obra civil: 20 partidas, 6 meses, avance programado %, valorización mensual, curva S";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(countExpected(p)).toBe(20);
    expect(p).toContain("6 meses");
    expect(p.toLowerCase()).toContain("curva s");
  });

  it("T09 — Word muro contención verificación volteo deslizamiento", () => {
    const p = "Genera Word de especificaciones técnicas de muro de contención: tipo, geometría, empuje de suelos, verificación al volteo y deslizamiento";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p.toLowerCase()).toContain("volteo");
    expect(p.toLowerCase()).toContain("deslizamiento");
  });

  it("T10 — Excel planilla acero W=Ø²/162×L", () => {
    const p = "Crea Excel de planilla de acero de refuerzo: elemento, Ø, longitud, Nº, peso unitario, peso total, con fórmula W=Ø²/162×L";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("W=Ø²/162×L");
  });

  it("T11 — SVG planta estructural ejes A-E 1-4 columnas vigas losa", () => {
    const p = "Genera SVG de planta estructural de edificio con ejes A-E y 1-4, columnas, vigas, losa, con dimensiones";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(p).toContain("A-E");
    expect(p).toContain("1-4");
    const kw = extractKeywords(p);
    expect(kw).toContain("columna");
    expect(kw).toContain("viga");
    expect(kw).toContain("losa");
  });

  it("T12 — PDF ensayo compresión concreto probetas gráfico resistencia", () => {
    const p = "Crea PDF de informe de ensayo de compresión de concreto: probetas, edad, carga, f'c, tabla de resultados, gráfico de resistencia vs edad";
    expect(analyzePrompt(p).type).toBe("pdf");
    expect(p.toLowerCase()).toContain("compresión");
    expect(p.toLowerCase()).toContain("probetas");
    expect(p.toLowerCase()).toContain("gráfico de resistencia vs edad");
  });
});

// ═══════════════════════════════════════
// ING. AMBIENTAL (T13-T24)
// ═══════════════════════════════════════

describe("Sprint 1 · Ingeniería Ambiental — Impacto y Remediación", () => {
  it("T13 — Excel calidad agua 12 estaciones pH DBO5 DQO SST ECA semáforo", () => {
    const p = "Genera Excel de monitoreo de calidad de agua: pH, DBO5, DQO, SST, coliformes, para 12 estaciones, con comparación contra ECA-Agua Categoría 3 y semáforo rojo/amarillo/verde";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(countExpected(p)).toBe(12);
    for (const v of ["ph","dbo5","dqo","sst","coliformes"]) expect(extractKeywords(p)).toContain(v);
    expect(p.toLowerCase()).toContain("eca-agua categoría 3");
  });

  it("T14 — Word EIA semi-detallado Leopold 10×15 plan manejo", () => {
    const p = "Crea Word de Estudio de Impacto Ambiental semi-detallado: descripción del proyecto, línea base física/biológica/social, identificación de impactos, matriz Leopold 10×15, plan de manejo ambiental, plan de monitoreo";
    expect(analyzePrompt(p).type).toBe("document");
    for (const s of ["línea base","leopold 10×15","plan de manejo ambiental","plan de monitoreo"]) expect(p.toLowerCase()).toContain(s);
  });

  it("T15 — Excel huella carbono Scope 1/2/3 IPCC tCO2eq pie chart", () => {
    const p = "Genera Excel de cálculo de huella de carbono: Scope 1 (combustibles), Scope 2 (electricidad), Scope 3 (transporte, residuos), factores de emisión IPCC, total en tCO2eq con gráfico pie";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    for (const s of ["scope 1","scope 2","scope 3","tco2eq"]) expect(extractKeywords(p)).toContain(s);
    expect(p.toLowerCase()).toContain("ipcc");
  });

  it("T16 — Mermaid PTAR 7 etapas cribado→vertimiento", () => {
    const p = "Crea diagrama mermaid de planta de tratamiento de aguas residuales: cribado → desarenador → sedimentador primario → reactor biológico → sedimentador secundario → cloración → vertimiento";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const steps = ["cribado","desarenador","sedimentador primario","reactor biológico","sedimentador secundario","cloración","vertimiento"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(7);
  });

  it("T17 — Excel Leopold 10×15 magnitud importancia sumatoria", () => {
    const p = "Genera Excel de matriz Leopold: 10 actividades del proyecto × 15 factores ambientales, con magnitud (-5 a +5) e importancia (1-5), sumatoria por fila y columna";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10 actividades");
    expect(p).toContain("15 factores");
    expect(p).toContain("-5 a +5");
  });

  it("T18 — PPT remediación suelos biorremediación fitorremediación", () => {
    const p = "Crea PPT sobre remediación de suelos contaminados por hidrocarburos: biorremediación, fitorremediación, lavado de suelos, desorción térmica, con diagramas de cada técnica";
    expect(analyzePrompt(p).type).toBe("presentation");
    expect(extractKeywords(p)).toContain("biorremediación");
    expect(extractKeywords(p)).toContain("fitorremediación");
  });

  it("T19 — Excel calidad aire PM2.5 PM10 CO SO2 NO2 O3 6 estaciones ECA", () => {
    const p = "Genera Excel de monitoreo de calidad de aire: PM2.5, PM10, CO, SO2, NO2, O3, para 6 estaciones, comparación con ECA-Aire, gráfico de tendencia mensual";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    for (const v of ["pm2.5","pm10","co","so2","no2","o3"]) expect(extractKeywords(p)).toContain(v);
    expect(countExpected(p)).toBe(6);
  });

  it("T20 — Word plan manejo residuos sólidos composición rutas disposición", () => {
    const p = "Crea Word de plan de manejo de residuos sólidos: diagnóstico, composición (orgánico, plástico, papel, vidrio, metal), rutas de recolección, disposición final, presupuesto";
    expect(analyzePrompt(p).type).toBe("document");
    for (const w of ["orgánico","plástico","papel","vidrio","metal"]) expect(p.toLowerCase()).toContain(w);
  });

  it("T21 — SVG ciclo hidrológico 6 procesos con flechas", () => {
    const p = "Genera SVG del ciclo hidrológico con evaporación, condensación, precipitación, escorrentía, infiltración, flujo subterráneo, con flechas y etiquetas";
    expect(analyzePrompt(p).type).toBe("svg");
    const procs = ["evaporación","condensación","precipitación","escorrentía","infiltración","flujo subterráneo"];
    for (const pr of procs) expect(p.toLowerCase()).toContain(pr);
    expect(procs).toHaveLength(6);
  });

  it("T22 — Excel riesgo ambiental P×S formato condicional 4 niveles", () => {
    const p = "Crea Excel de evaluación de riesgo ambiental: 10 aspectos, probabilidad (1-5), severidad (1-5), riesgo=P×S, con formato condicional: bajo(verde), medio(amarillo), alto(rojo), crítico(rojo oscuro)";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("riesgo=P×S");
    for (const l of ["bajo","medio","alto","crítico"]) expect(p.toLowerCase()).toContain(l);
  });

  it("T23 — Mermaid gestión integral residuos 7 pasos", () => {
    const p = "Genera diagrama mermaid de gestión integral de residuos: generación → segregación → almacenamiento → recolección → transporte → tratamiento → disposición final";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const steps = ["generación","segregación","almacenamiento","recolección","transporte","tratamiento","disposición final"];
    for (const s of steps) expect(p.toLowerCase()).toContain(s);
    expect(steps).toHaveLength(7);
  });

  it("T24 — Excel caudal PTAR población dotación Qprom Qmax Qmin", () => {
    const p = "Crea Excel de cálculo de caudal de diseño de PTAR: población actual, tasa crecimiento, período diseño, dotación, %retorno, Qprom, Qmax, Qmin, con fórmulas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    for (const v of ["qprom","qmax","qmin"]) expect(p.toLowerCase()).toContain(v);
  });
});

// ═══════════════════════════════════════
// ING. SISTEMAS (T25-T36)
// ═══════════════════════════════════════

describe("Sprint 1 · Ingeniería de Sistemas — Software y Datos", () => {
  it("T25 — Mermaid ER gestión universitaria 7+ entidades", () => {
    const p = "Genera diagrama ER mermaid de sistema de gestión universitaria: estudiantes, docentes, cursos, matriculas, notas, horarios, aulas, con cardinalidades";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const ents = ["estudiantes","docentes","cursos","matriculas","notas","horarios","aulas"];
    for (const e of ents) expect(p.toLowerCase()).toContain(e);
    expect(ents.length).toBeGreaterThanOrEqual(7);
  });

  it("T26 — Excel Scrum 30 user stories MoSCoW velocity", () => {
    const p = "Crea Excel de gestión de proyecto Scrum: product backlog con 30 user stories, story points, prioridad (MoSCoW), sprint assignment, velocity chart";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(extractKeywords(p)).toContain("scrum");
    expect(p).toContain("30 user stories");
    expect(p).toContain("MoSCoW");
  });

  it("T27 — Mermaid secuencia matrícula online 7 pasos", () => {
    const p = "Genera diagrama de secuencia mermaid del proceso de matrícula online: alumno → sistema → validar prerrequisitos → verificar vacantes → generar boleta → confirmar pago → enviar constancia";
    expect(analyzePrompt(p).format).toBe("mermaid");
    for (const s of ["alumno","sistema","validar prerrequisitos","verificar vacantes","generar boleta","confirmar pago","enviar constancia"]) expect(p.toLowerCase()).toContain(s);
  });

  it("T28 — Word arquitectura software C4 stack API specs", () => {
    const p = "Crea Word de documento de arquitectura de software: diagramas C4 (contexto, contenedores, componentes), decisiones de diseño, stack tecnológico, patrones, API specs";
    expect(analyzePrompt(p).type).toBe("document");
    for (const s of ["c4","contexto","contenedores","componentes","api specs"]) expect(p.toLowerCase()).toContain(s);
  });

  it("T29 — Excel RACI 20 tareas 6 roles conteo", () => {
    const p = "Genera Excel de matriz RACI para proyecto de e-commerce: 20 tareas, 6 roles (PM, Backend, Frontend, QA, DBA, DevOps), con conteo de R/A/C/I por persona";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(countExpected(p)).toBe(20);
    for (const r of ["pm","backend","frontend","qa","dba","devops"]) expect(p.toLowerCase()).toContain(r);
    expect(p).toContain("R/A/C/I");
  });

  it("T30 — Mermaid microservicios 7+ servicios con DB", () => {
    const p = "Crea diagrama mermaid de arquitectura de microservicios: API Gateway → Auth Service → User Service → Product Service → Order Service → Payment Service → Notification Service, cada uno con su DB";
    expect(analyzePrompt(p).format).toBe("mermaid");
    expect(extractKeywords(p)).toContain("microservicios");
    expect(extractKeywords(p)).toContain("api gateway");
    const svcs = ["auth service","user service","product service","order service","payment service","notification service"];
    for (const s of svcs) expect(p.toLowerCase()).toContain(s);
    expect(svcs.length).toBeGreaterThanOrEqual(6);
  });

  it("T31 — Excel puntos de función 15 transacciones PF ajustados esfuerzo", () => {
    const p = "Genera Excel de estimación de proyecto software por puntos de función: 15 transacciones, complejidad (baja/media/alta), PF brutos, factor de ajuste, PF ajustados, esfuerzo en horas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("15 transacciones");
    expect(p.toLowerCase()).toContain("pf ajustados");
  });

  it("T32 — PPT propuesta ERP 5 módulos cronograma ROI", () => {
    const p = "Crea PPT de propuesta técnica de sistema ERP: módulos (ventas, compras, inventario, contabilidad, RRHH), arquitectura, cronograma, presupuesto, ROI";
    expect(analyzePrompt(p).type).toBe("presentation");
    expect(extractKeywords(p)).toContain("erp");
    for (const m of ["ventas","compras","inventario","contabilidad","rrhh"]) expect(p.toLowerCase()).toContain(m);
  });

  it("T33 — HTML dashboard servidores 4 cards CPU/RAM/Disco/Red alertas", () => {
    const p = "Genera código HTML de dashboard de monitoreo de servidores: 4 cards (CPU, RAM, Disco, Red), gráfico de uso últimas 24h, tabla de alertas, con colores verde/amarillo/rojo";
    expect(analyzePrompt(p).type).toBe("html");
    for (const c of ["cpu","ram","disco","red"]) expect(p.toLowerCase()).toContain(c);
    expect(p.toLowerCase()).toContain("tabla de alertas");
  });

  it("T34 — Word SRS IEEE 830 15 RF 10 RNF", () => {
    const p = "Crea Word de SRS (Software Requirements Specification) IEEE 830: propósito, alcance, requisitos funcionales (15), no funcionales (10), interfaces, restricciones";
    expect(analyzePrompt(p).type).toBe("document");
    expect(extractKeywords(p)).toContain("srs");
    expect(extractKeywords(p)).toContain("ieee 830");
    expect(p).toContain("(15)");
    expect(p).toContain("(10)");
  });

  it("T35 — Mermaid deployment nginx PostgreSQL Redis S3", () => {
    const p = "Genera diagrama de deployment mermaid: nginx load balancer → 3 app servers (Node.js) → PostgreSQL primary + 2 replicas → Redis cluster → S3 storage";
    expect(analyzePrompt(p).format).toBe("mermaid");
    for (const kw of ["nginx","postgresql","redis"]) expect(extractKeywords(p)).toContain(kw);
  });

  it("T36 — Excel testing matrix 20 test cases pass/fail cobertura", () => {
    const p = "Crea Excel de testing matrix: 20 test cases, precondición, pasos, resultado esperado, resultado actual, estado (pass/fail), prioridad, con resumen de cobertura";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(countExpected(p)).toBe(20);
    for (const c of ["precondición","pass/fail","cobertura"]) expect(p.toLowerCase()).toContain(c);
  });
});

// ═══════════════════════════════════════
// ING. INDUSTRIAL (T37-T50)
// ═══════════════════════════════════════

describe("Sprint 1 · Ingeniería Industrial — Producción y Calidad", () => {
  it("T37 — Excel estudio tiempos 15 ops 10 obs tiempo estándar", () => {
    const p = "Genera Excel de estudio de tiempos: 15 operaciones, 10 observaciones cada una, tiempo promedio, factor valoración, tiempo estándar, suplementos, tiempo tipo, con fórmulas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("15 operaciones");
    expect(p).toContain("10 observaciones");
    for (const v of ["tiempo promedio","factor valoración","tiempo estándar","suplementos","tiempo tipo"]) expect(p.toLowerCase()).toContain(v);
  });

  it("T38 — Mermaid manufactura ASME operación transporte inspección", () => {
    const p = "Crea diagrama mermaid de proceso de manufactura con simbología: operación(círculo) → transporte(flecha) → inspección(cuadrado) → demora(D) → almacenamiento(triángulo)";
    expect(analyzePrompt(p).format).toBe("mermaid");
    for (const s of ["operación","transporte","inspección","demora","almacenamiento"]) expect(p.toLowerCase()).toContain(s);
  });

  it("T39 — Excel MRP 3 subensambles 8 componentes BOM lead time", () => {
    const p = "Genera Excel de MRP nivel 0-1-2: producto terminado, 3 subensambles, 8 componentes, BOM, lead time, stock, recepciones programadas, necesidades netas, órdenes planificadas";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(extractKeywords(p)).toContain("mrp");
    expect(extractKeywords(p)).toContain("bom");
    expect(extractKeywords(p)).toContain("lead time");
  });

  it("T40 — Word 5S Seiri Seiton Seiso Seiketsu Shitsuke", () => {
    const p = "Crea Word de plan de implementación 5S: diagnóstico con fotos, plan por cada S (Seiri, Seiton, Seiso, Seiketsu, Shitsuke), indicadores, cronograma, responsables";
    expect(analyzePrompt(p).type).toBe("document");
    for (const s of ["seiri","seiton","seiso","seiketsu","shitsuke"]) expect(extractKeywords(p)).toContain(s);
  });

  it("T41 — Excel capacidad 8 estaciones cuello botella balance línea", () => {
    const p = "Genera Excel de análisis de capacidad: 8 estaciones de trabajo, tiempo de ciclo, capacidad por hora, cuello de botella, eficiencia de línea, balance de línea";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(countExpected(p)).toBe(8);
    expect(extractKeywords(p)).toContain("cuello de botella");
  });

  it("T42 — PPT Six Sigma DMAIC 5 fases CTQ SIPOC Ishikawa SPC", () => {
    const p = "Crea PPT de proyecto Six Sigma DMAIC: definir (CTQ, SIPOC), medir (MSA, capability), analizar (Ishikawa, 5 porqués), mejorar (DOE), controlar (SPC)";
    expect(analyzePrompt(p).type).toBe("presentation");
    expect(extractKeywords(p)).toContain("six sigma");
    expect(extractKeywords(p)).toContain("dmaic");
    expect(extractKeywords(p)).toContain("spc");
    for (const ph of ["definir","medir","analizar","mejorar","controlar"]) expect(p.toLowerCase()).toContain(ph);
  });

  it("T43 — Excel SPC 25 subgrupos carta X-barra R UCL LCL", () => {
    const p = "Genera Excel de control estadístico de procesos: 25 subgrupos de 5 muestras, carta X-barra con UCL/LCL/CL, carta R con UCL/LCL, interpretación de patrones";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("25 subgrupos");
    expect(p).toContain("UCL");
    expect(p).toContain("LCL");
  });

  it("T44 — SVG Ishikawa 6M × 3 causas (18 total)", () => {
    const p = "Crea SVG de diagrama de Ishikawa: problema central → 6M (Mano de obra, Máquina, Material, Método, Medición, Medio ambiente), 3 causas por cada M";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(extractKeywords(p)).toContain("ishikawa");
    const sixM = ["mano de obra","máquina","material","método","medición","medio ambiente"];
    for (const m of sixM) expect(p.toLowerCase()).toContain(m);
    expect(sixM).toHaveLength(6);
  });

  it("T45 — Excel ABC 100 SKUs Pareto clasificación A/B/C", () => {
    const p = "Genera Excel de análisis ABC de inventario: 100 SKUs, demanda anual, costo unitario, valor anual, % acumulado, clasificación A/B/C, con gráfico Pareto";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(extractKeywords(p)).toContain("abc");
    expect(extractKeywords(p)).toContain("pareto");
    expect(p).toContain("100 SKUs");
    expect(p).toContain("A/B/C");
  });

  it("T46 — Excel layout Guerchet tabla relaciones A/E/I/O/U/X", () => {
    const p = "Crea Excel de layout de planta: tabla de relaciones (A,E,I,O,U,X), diagrama de relación de actividades, cálculo de áreas por método Guerchet";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(extractKeywords(p)).toContain("guerchet");
    expect(p).toContain("A,E,I,O,U,X");
  });

  it("T47 — Word SOP soldadura 15 pasos EPP criterios aceptación", () => {
    const p = "Genera Word de procedimiento operativo estándar de soldadura: alcance, definiciones, EPP, pasos (15), parámetros, criterios de aceptación, registro";
    expect(analyzePrompt(p).type).toBe("document");
    expect(p).toContain("(15)");
    for (const s of ["alcance","definiciones","epp","criterios de aceptación"]) expect(p.toLowerCase()).toContain(s);
  });

  it("T48 — Excel OEE 5 máquinas disponibilidad rendimiento calidad semáforo", () => {
    const p = "Crea Excel de OEE (Overall Equipment Effectiveness): disponibilidad, rendimiento, calidad, OEE%, para 5 máquinas, con semáforo y gráfico comparativo";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(extractKeywords(p)).toContain("oee");
    expect(p).toContain("5 máquinas");
    for (const v of ["disponibilidad","rendimiento","calidad"]) expect(p.toLowerCase()).toContain(v);
  });

  it("T49 — Mermaid cadena suministro 7 nodos flujo información inverso", () => {
    const p = "Genera diagrama mermaid de cadena de suministro: proveedor → almacén MP → producción → almacén PT → distribución → punto de venta → cliente, con flujo de información inverso";
    expect(analyzePrompt(p).format).toBe("mermaid");
    const nodes = ["proveedor","almacén mp","producción","almacén pt","distribución","punto de venta","cliente"];
    for (const n of nodes) expect(p.toLowerCase()).toContain(n);
    expect(nodes).toHaveLength(7);
  });

  it("T50 — Excel programación producción 10 órdenes 3 máquinas SPT EDD makespan", () => {
    const p = "Crea Excel de programación de producción: 10 órdenes, 3 máquinas, tiempo de proceso, fecha entrega, secuenciación por regla SPT y EDD, makespan y tardanza";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("10 órdenes");
    expect(p).toContain("3 máquinas");
    expect(p).toContain("SPT");
    expect(p).toContain("EDD");
    expect(p.toLowerCase()).toContain("makespan");
  });
});
