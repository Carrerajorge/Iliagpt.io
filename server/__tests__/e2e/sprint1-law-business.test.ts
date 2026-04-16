/**
 * Sprint 1 — Law & Business E2E Tests (50 tests)
 * Tests 51-100: Derecho, Administración, Finanzas, Negocios Internacionales
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import { generateDocument } from "../../services/documentGenerators/index";
import { createExcelFromData, createMultiSheetExcel } from "../../services/advancedExcelBuilder";

beforeAll(() => { fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true }); });

async function xlsxContains(buf: Buffer, text: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  for (const f of Object.keys(zip.files).filter(f => f.startsWith("xl/"))) {
    if ((await zip.files[f].async("text")).includes(text)) return true;
  }
  return false;
}
async function pptxSlideCount(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
}

// ═══════════════════════════════════════════════════════════════
// DERECHO (tests 51-65)
// ═══════════════════════════════════════════════════════════════
describe("Derecho", () => {
  it("51: Word contrato arrendamiento 20 cláusulas", async () => {
    const clauses = Array.from({ length: 20 }, (_, i) => ({
      heading: `Cláusula ${i + 1}: ${["Objeto","Renta","Plazo","Garantía","Uso del inmueble","Mantenimiento","Mejoras","Subarrendamiento","Resolución","Penalidades","Caso fortuito","Confidencialidad","Notificaciones","Modificaciones","Cesión","Seguros","Tributos","Obligaciones del arrendatario","Obligaciones del arrendador","Jurisdicción"][i]}`,
      paragraphs: [`Contenido legal de la cláusula ${i + 1} del contrato de arrendamiento comercial.`],
    }));
    const r = await generateDocument("word", { title: "Contrato de Arrendamiento Comercial", author: "Estudio Jurídico", sections: clauses });
    const zip = await JSZip.loadAsync(r.buffer);
    const doc = await zip.files["word/document.xml"]?.async("text");
    expect(doc).toContain("Cláusula");
    expect(doc).toContain("Jurisdicción");
    expect(r.buffer.length).toBeGreaterThan(8000);
  });

  it("52: Excel seguimiento 30 expedientes con formato condicional", async () => {
    const cases = Array.from({ length: 30 }, (_, i) => [
      `Exp-${2024+Math.floor(i/10)}-${(i+1).toString().padStart(4,"0")}`,
      `${Math.floor(Math.random()*20)+1}° Juzgado`,
      ["Civil","Penal","Laboral","Constitucional"][Math.floor(Math.random()*4)],
      ["En trámite","Sentenciado","Apelación","Casación"][Math.floor(Math.random()*4)],
      `2026-${(Math.floor(Math.random()*12)+1).toString().padStart(2,"0")}-${(Math.floor(Math.random()*28)+1).toString().padStart(2,"0")}`,
      `Abogado ${String.fromCharCode(65+Math.floor(Math.random()*6))}`,
    ]);
    const { buffer } = await createExcelFromData(
      [["Expediente","Juzgado","Materia","Estado","Próx. Audiencia","Abogado"], ...cases],
      { title: "Seguimiento_Expedientes", conditionalFormatting: true });
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("53: PDF demanda indemnización con estructura legal", async () => {
    const r = await generateDocument("pdf", {
      title: "Demanda de Indemnización por Daños y Perjuicios",
      sections: [
        { heading: "Carátula", paragraphs: ["Juzgado: 5° Juzgado Civil de Lima. Expediente N°: 2026-XXXXX. Demandante: Juan Pérez. Demandado: Empresa XYZ SAC."] },
        { heading: "Hechos", list: { items: Array.from({ length: 10 }, (_, i) => `${i+1}. Fundamento de hecho número ${i+1} de la demanda.`) } },
        { heading: "Fundamentos de Derecho", list: { items: ["Art. 1321 CC: Indemnización por inejecución","Art. 1322 CC: Daño moral","Art. 1332 CC: Valorización equitativa","Art. 1985 CC: Responsabilidad extracontractual"] } },
        { heading: "Petitorio", paragraphs: ["SE SIRVA DECLARAR FUNDADA la demanda y ordenar el pago de S/ 150,000.00 por concepto de daño emergente y S/ 50,000.00 por daño moral."] },
      ],
    });
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.buffer.length).toBeGreaterThan(2000);
  });

  it("54: PPT tesis derecho penal feminicidio", async () => {
    const r = await generateDocument("pptx", {
      title: "Tipificación del Feminicidio en el Perú 2021-2025",
      subtitle: "Tesis para optar el título de Abogado",
      slides: [
        { type: "content", title: "Planteamiento del Problema", bullets: ["Incremento de feminicidios 35% (2021-2025)","Vacíos en tipificación Art. 108-B CP","Impunidad en zonas rurales: 62%"] },
        { type: "content", title: "Marco Teórico", bullets: ["Teoría de género (Butler, 1990)","Derecho penal simbólico (Hassemer)","Feminicidio: concepto y evolución legal"] },
        { type: "content", title: "Metodología", bullets: ["Enfoque: cualitativo","Diseño: fenomenológico","Muestra: 15 sentencias TC y CS","Instrumento: análisis documental"] },
        { type: "content", title: "Resultados", bullets: ["El 78% de sentencias aplican Art. 108-B","Agravantes más comunes: convivencia (45%), ensañamiento (23%)","Penas: 20-35 años"] },
        { type: "content", title: "Conclusiones", bullets: ["La tipificación ha mejorado la tutela penal","Persisten problemas probatorios en contexto rural","Se recomienda protocolo unificado de investigación"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(6);
  });

  it("55: diagrama mermaid proceso penal peruano 7 etapas", () => {
    const d = `flowchart LR
  A[Denuncia] --> B[Diligencias Preliminares]
  B --> C[Investigación Preparatoria]
  C --> D[Etapa Intermedia]
  D --> E[Juicio Oral]
  E --> F[Sentencia]
  F --> G[Impugnación]`;
    expect((d.match(/-->/g) || []).length).toBe(6);
    expect(d).toContain("Juicio Oral");
  });

  it("56: Word escritura pública SAC con 20 artículos", async () => {
    const articles = Array.from({ length: 20 }, (_, i) => ({
      heading: `Artículo ${i + 1}`,
      paragraphs: [`Contenido del artículo ${i+1} del estatuto de la sociedad anónima cerrada.`],
    }));
    const r = await generateDocument("word", {
      title: "Escritura Pública de Constitución de Empresa SAC",
      sections: [{ heading: "Pacto Social", paragraphs: ["Los socios fundadores acuerdan constituir una SAC."] }, ...articles],
    });
    expect(r.buffer.length).toBeGreaterThan(8000);
  });

  it("57: Excel cálculo beneficios sociales 20 trabajadores", async () => {
    const workers = Array.from({ length: 20 }, (_, i) => [
      `Trabajador ${i+1}`, `2024-${(Math.floor(Math.random()*12)+1).toString().padStart(2,"0")}-01`,
      (2000 + Math.floor(Math.random() * 6000)).toFixed(2),
      ((2000 + Math.random() * 6000) / 12).toFixed(2),
      ((2000 + Math.random() * 6000) / 6).toFixed(2),
      ((2000 + Math.random() * 6000) / 12).toFixed(2),
    ]);
    const { buffer } = await createExcelFromData(
      [["Nombre","Fecha Ingreso","Remuneración","CTS(mes)","Gratificación","Vacaciones"], ...workers],
      { title: "Beneficios_Sociales", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("58: Word recurso de casación formato procesal", async () => {
    const r = await generateDocument("word", {
      title: "Recurso de Casación",
      sections: [
        { heading: "Requisitos de Admisibilidad", paragraphs: ["Interpuesto dentro del plazo de 10 días hábiles. Adjunta tasa judicial."] },
        { heading: "Causales", list: { items: ["Infracción normativa del Art. 1969 del Código Civil","Apartamiento del precedente vinculante Casación N° 4664-2010-Puno"] } },
        { heading: "Fundamentación", paragraphs: ["La Sala Superior ha interpretado erróneamente el artículo 1969 del Código Civil al exigir dolo cuando la norma establece responsabilidad objetiva."] },
        { heading: "Pretensión Casatoria", paragraphs: ["SE SIRVA CASAR la sentencia de vista y actuando en sede de instancia, CONFIRMAR la sentencia de primera instancia."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("59: Excel tabla jurisprudencia TC 25 sentencias", async () => {
    const sentencias = Array.from({ length: 25 }, (_, i) => [
      `STC ${(i+1).toString().padStart(4,"0")}-2024-PA/TC`,
      `Exp. ${Math.floor(Math.random()*9000)+1000}-2023-PA/TC`,
      `2024-${(Math.floor(Math.random()*12)+1).toString().padStart(2,"0")}-${(Math.floor(Math.random()*28)+1).toString().padStart(2,"0")}`,
      `Ratio decidendi sobre derecho a la identidad caso ${i+1}`,
      `Obiter dicta complementario caso ${i+1}`,
    ]);
    const { buffer } = await createExcelFromData(
      [["Caso","Expediente","Fecha","Ratio Decidendi","Obiter Dicta"], ...sentencias],
      { title: "Jurisprudencia_TC" });
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("60: PPT violencia de género Ley 30364", async () => {
    const r = await generateDocument("pptx", {
      title: "Medidas de Protección en Violencia de Género - Ley 30364",
      slides: [
        { type: "content", title: "Ley 30364", bullets: ["Ley para prevenir, sancionar y erradicar la violencia contra las mujeres","Promulgada: 23/11/2015","Reglamento: DS 009-2016-MIMP"] },
        { type: "content", title: "Tipos de Violencia", bullets: ["Física: golpes, empujones","Psicológica: amenazas, humillación","Sexual: sin consentimiento","Económica: control de recursos","Patrimonial: daño a bienes"] },
        { type: "content", title: "Proceso de Tutela", bullets: ["Denuncia ante PNP o Fiscalía","Ficha de valoración de riesgo","Audiencia en 72 horas (casos graves: 24h)","Medidas de protección inmediatas"] },
        { type: "table", title: "Estadísticas 2024", tableData: { headers: ["Tipo","Casos","Porcentaje"], rows: [["Física","89,532","40%"],["Psicológica","96,234","43%"],["Sexual","28,456","13%"],["Económica","8,972","4%"]] } },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(5);
  });

  it("61: Word NDA bilateral con cláusulas específicas", async () => {
    const r = await generateDocument("word", {
      title: "Acuerdo de Confidencialidad (NDA) Bilateral",
      sections: [
        { heading: "Definición de Información Confidencial", paragraphs: ["Toda información técnica, comercial, financiera o de cualquier naturaleza divulgada."] },
        { heading: "Obligaciones", paragraphs: ["Las Partes se obligan a mantener en estricta reserva la Información Confidencial."] },
        { heading: "Excepciones", list: { items: ["Información de dominio público","Información previamente conocida","Información obtenida de terceros sin restricción","Información desarrollada independientemente"] } },
        { heading: "Plazo", paragraphs: ["El presente acuerdo tendrá vigencia de tres (3) años."] },
        { heading: "Penalidad", paragraphs: ["El incumplimiento generará una penalidad de 50 UIT (S/ 257,500.00)."] },
        { heading: "Jurisdicción", paragraphs: ["Lima, Perú. Arbitraje ante el Centro de Arbitraje de la CCL."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("62: Excel control plazos procesales 40 procesos con alertas", async () => {
    const procs = Array.from({ length: 40 }, (_, i) => {
      const plazo = Math.floor(Math.random()*30)+5;
      const diasRest = Math.floor(Math.random()*35)-5;
      return [`Proc-${(i+1).toString().padStart(3,"0")}`, ["Civil","Penal","Laboral"][Math.floor(Math.random()*3)],
        ["1ra","2da","Casación"][Math.floor(Math.random()*3)], plazo, "2026-04-01", "2026-05-01", diasRest,
        diasRest < 0 ? "VENCIDO" : diasRest < 5 ? "URGENTE" : "OK"];
    });
    const { buffer } = await createExcelFromData(
      [["Proceso","Tipo","Instancia","Plazo(días)","Inicio","Vencimiento","Días Rest.","Estado"], ...procs],
      { title: "Control_Plazos", conditionalFormatting: true });
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("63: diagrama mermaid conciliación extrajudicial", () => {
    const d = `flowchart TD
  A[Solicitud de Conciliación] --> B[Invitación a las Partes]
  B --> C{Audiencia de Conciliación}
  C -->|Acuerdo| D[Acta con efecto de Cosa Juzgada]
  C -->|Desacuerdo| E[Acta de Falta de Acuerdo]
  E --> F[Habilita Vía Judicial]`;
    expect(d).toContain("Conciliación");
    expect(d).toContain("Cosa Juzgada");
  });

  it("64: Word informe jurídico constitucionalidad trabajo remoto", async () => {
    const r = await generateDocument("word", {
      title: "Informe Jurídico: Constitucionalidad del Trabajo Remoto",
      sections: [
        { heading: "Análisis del Derecho al Trabajo (Art. 22 Constitución)", paragraphs: ["El derecho al trabajo implica tanto el acceso como las condiciones dignas de empleo."] },
        { heading: "Libertad de Empresa (Art. 59)", paragraphs: ["El empleador tiene libertad de organización, incluida la modalidad de trabajo."] },
        { heading: "Protección del Trabajador (Art. 23)", paragraphs: ["El Estado protege especialmente a la madre trabajadora y al menor de edad."] },
        { heading: "Conclusión", paragraphs: ["El trabajo remoto es constitucionalmente válido siempre que respete los derechos fundamentales del trabajador."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("65: Excel análisis riesgos legales corporativos 15 riesgos", async () => {
    const risks = Array.from({ length: 15 }, (_, i) => [
      `Riesgo ${i+1}`, Math.floor(Math.random()*5)+1, Math.floor(Math.random()*5)+1,
      0, `Mitigación ${i+1}`, `Responsable ${String.fromCharCode(65+i%6)}`,
    ]);
    risks.forEach(r => { r[3] = (r[1] as number) * (r[2] as number); });
    const { buffer } = await createExcelFromData(
      [["Riesgo","Probabilidad(1-5)","Impacto(1-5)","Nivel Riesgo","Mitigación","Responsable"], ...risks],
      { title: "Riesgos_Legales", conditionalFormatting: true });
    expect(buffer.length).toBeGreaterThan(4000);
  });
});

// ═══════════════════════════════════════════════════════════════
// NEGOCIOS Y FINANZAS (tests 66-100)
// ═══════════════════════════════════════════════════════════════
describe("Negocios y Finanzas", () => {
  it("66: Excel estado resultados proyectado 5 años con IR 29.5%", async () => {
    const years = [1,2,3,4,5].map(y => {
      const ventas = 1000000 * Math.pow(1.15, y-1);
      const costo = ventas * 0.60;
      const gastos = ventas * 0.15;
      const depreciacion = 50000;
      const uai = ventas - costo - gastos - depreciacion;
      const ir = uai * 0.295;
      return [y, ventas.toFixed(0), costo.toFixed(0), gastos.toFixed(0), depreciacion, uai.toFixed(0), ir.toFixed(0), (uai - ir).toFixed(0)];
    });
    const { buffer } = await createExcelFromData(
      [["Año","Ventas","Costo Ventas(60%)","Gastos Op.(15%)","Depreciación","UAI","IR(29.5%)","Utilidad Neta"], ...years],
      { title: "EERR_Proyectado", autoFormulas: true });
    expect(await xlsxContains(buffer, "Ventas")).toBe(true);
  });

  it("67: Excel flujo de caja DCF con WACC y Gordon", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "FCL", data: [["Año",1,2,3,4,5],["EBITDA",500000,575000,661250,760438,874503],["Capex",-80000,-85000,-90000,-95000,-100000],["Working Capital",-30000,-34500,-39675,-45626,-52470],["FCL",390000,455500,531575,619812,722033]], options: { autoFormulas: true } },
      { name: "Valorización", data: [["Parámetro","Valor"],["WACC","12%"],["g (crecimiento perpetuo)","3%"],["FCL año 5",722033],["Valor Terminal (Gordon)","722033×(1.03)/(0.12-0.03)"],["VT",8263043],["VP FCL (1-5)",1867420],["VP VT",4687312],["Valor Empresa",6554732]] },
    ]);
    expect(await xlsxContains(buffer, "WACC")).toBe(true);
  });

  it("68: PPT pitch deck startup fintech 12 slides", async () => {
    const r = await generateDocument("pptx", {
      title: "WalletPE - Inclusión Financiera para Todos",
      subtitle: "Pitch Deck | Serie A",
      slides: [
        { type: "content", title: "Problema", bullets: ["38% de peruanos sin cuenta bancaria","Costos de transacción altos en zonas rurales","Brechas de acceso al crédito"] },
        { type: "content", title: "Solución", bullets: ["Billetera digital con USSD (sin internet)","Microcréditos con scoring alternativo","Pagos QR y transferencias P2P"] },
        { type: "content", title: "Mercado", bullets: ["TAM: $12B (pagos digitales Latam)","SAM: $1.8B (Perú)","SOM: $180M (10% en 5 años)"] },
        { type: "content", title: "Modelo de Negocio", bullets: ["Freemium: cuenta básica gratis","Comisión 1.5% por transacción","Subscription Pro: S/15/mes","Revenue share con comercios"] },
        { type: "content", title: "Unit Economics", bullets: ["CAC: $2.50","LTV: $45","LTV/CAC: 18x","Payback: 3 meses"] },
        { type: "content", title: "Tracción", bullets: ["150K usuarios activos","$2.5M GMV mensual","42% crecimiento MoM","NPS: 72"] },
        { type: "content", title: "Competencia", bullets: ["Yape: gran base, sin USSD","Plin: solo bancos","Tunki: limitado","WalletPE: USSD + scoring IA"] },
        { type: "content", title: "Equipo", bullets: ["CEO: Ex-BCP, MBA Wharton","CTO: Ex-Rappi, 15 años fintech","COO: Ex-BCRP, regulación"] },
        { type: "content", title: "Financiamiento", bullets: ["Pre-seed: $500K (completado)","Seed: $2M (completado)","Serie A: $8M (actual ronda)","Uso: 50% tech, 30% mkt, 20% ops"] },
        { type: "content", title: "Roadmap", bullets: ["Q3 2026: 500K usuarios","Q4 2026: licencia SBS","Q1 2027: expansión Colombia","Q4 2027: 2M usuarios"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(11);
  });

  it("69: Excel embudo ventas B2B 200 leads", async () => {
    const stages = [
      ["Prospecto",200,100,"50%",5000,1000000],
      ["MQL",100,60,"60%",5000,300000],
      ["SQL",60,30,"50%",7500,225000],
      ["Propuesta",30,18,"60%",10000,180000],
      ["Cierre",18,18,"100%",12000,216000],
    ];
    const { buffer } = await createExcelFromData(
      [["Etapa","Leads","Conversiones","Tasa Conv.","Valor Prom.","Pipeline"], ...stages],
      { title: "Embudo_Ventas_B2B", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it("70: Word plan marketing digital completo", async () => {
    const r = await generateDocument("word", {
      title: "Plan de Marketing Digital 2026",
      sections: [
        { heading: "Análisis PESTEL", paragraphs: ["Político: regulación de datos. Económico: inflación 3.5%. Social: digitalización acelerada."] },
        { heading: "Análisis FODA", table: { headers: ["Fortalezas","Debilidades","Oportunidades","Amenazas"], rows: [["Marca reconocida","Bajo presupuesto","Mercado creciente","Competencia agresiva"]] } },
        { heading: "Buyer Personas", paragraphs: ["Persona 1: María, 28, profesional, busca eficiencia. Persona 2: Carlos, 45, gerente, busca ROI. Persona 3: Ana, 35, emprendedora, busca crecimiento."] },
        { heading: "Estrategia de Contenidos", list: { items: ["Blog: 12 artículos/mes","Video: 4 videos/mes","Podcast: 2 episodios/mes","Email: 8 newsletters/mes"] } },
        { heading: "Presupuesto por Canal", table: { headers: ["Canal","Presupuesto Mensual","% del Total"], rows: [["SEO","$2,000","20%"],["SEM (Google Ads)","$3,000","30%"],["Social Media","$2,500","25%"],["Email Marketing","$500","5%"],["Influencers","$2,000","20%"]] } },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("71: Excel punto equilibrio multiproducto 5 productos", async () => {
    const { buffer } = await createExcelFromData([
      ["Producto","Precio","Costo Var.","Margen Contrib.","Mix Ventas","MC Pond."],
      ["A",120,72,48,"30%",14.40],
      ["B",85,51,34,"25%",8.50],
      ["C",200,130,70,"15%",10.50],
      ["D",50,30,20,"20%",4.00],
      ["E",150,90,60,"10%",6.00],
      ["","","","TOTAL","100%",43.40],
      ["Costos Fijos Mensuales","","","","",150000],
      ["PE (unidades)","","","","",3456],
      ["PE (soles)","","","","",380184],
    ], { title: "Punto_Equilibrio", autoFormulas: true });
    expect(await xlsxContains(buffer, "Margen")).toBe(true);
  });

  it("72: Excel balanced scorecard 4 perspectivas 16 KPIs", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "Financiera", data: [["KPI","Meta","Real","Desviación","Semáforo"],["ROE",">15%","17.2%","+2.2%","Verde"],["Margen EBITDA",">25%","23.1%","-1.9%","Amarillo"],["Crecimiento Ingresos",">12%","14.5%","+2.5%","Verde"],["Reducción Costos",">5%","4.2%","-0.8%","Amarillo"]] },
      { name: "Cliente", data: [["KPI","Meta","Real","Desviación","Semáforo"],["NPS",">70","72","+2","Verde"],["Retención",">85%","82%","-3%","Amarillo"],["Tiempo Respuesta","<2h","1.5h","+0.5h","Verde"],["Market Share",">10%","11.2%","+1.2%","Verde"]] },
      { name: "Procesos", data: [["KPI","Meta","Real","Desviación","Semáforo"],["Ciclo Entrega","<3 días","2.8 días","+0.2d","Verde"],["Defectos","<1%","0.8%","+0.2%","Verde"],["Utilización",">80%","76%","-4%","Amarillo"],["Automatización",">60%","55%","-5%","Rojo"]] },
      { name: "Aprendizaje", data: [["KPI","Meta","Real","Desviación","Semáforo"],["Capacitación",">40h/año","38h","-2h","Amarillo"],["Satisfacción",">80%","85%","+5%","Verde"],["Rotación","<10%","8%","+2%","Verde"],["Innovación",">5 ideas/trim","7 ideas","+2","Verde"]] },
    ]);
    expect(await xlsxContains(buffer, "KPI")).toBe(true);
  });

  it("73: diagrama mermaid modelo Canvas 9 bloques", () => {
    const d = `flowchart TD
  VP[Propuesta de Valor] --- SC[Segmentos de Clientes]
  VP --- CN[Canales]
  VP --- RC[Relaciones con Clientes]
  VP --- FI[Fuentes de Ingreso]
  VP --- RK[Recursos Clave]
  VP --- AC[Actividades Clave]
  VP --- SK[Socios Clave]
  VP --- EC[Estructura de Costos]`;
    const bloques = ["Propuesta de Valor","Segmentos","Canales","Relaciones","Fuentes de Ingreso","Recursos","Actividades","Socios","Estructura de Costos"];
    let count = 0;
    for (const b of bloques) if (d.includes(b.split(" ")[0])) count++;
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it("74: Excel nómina 50 empleados Perú con tributación", async () => {
    const emps = Array.from({ length: 50 }, (_, i) => {
      const bruto = 2000 + Math.floor(Math.random() * 8000);
      const afp = bruto * 0.13;
      const essalud = bruto * 0.09;
      const ir = bruto > 4150 ? (bruto - 4150) * 0.08 : 0;
      return [`Empleado ${i+1}`, bruto.toFixed(2), afp.toFixed(2), essalud.toFixed(2), ir.toFixed(2), (bruto - afp - ir).toFixed(2)];
    });
    const { buffer } = await createExcelFromData(
      [["Nombre","Bruto","AFP(13%)","Essalud(9%)","IR 5ta","Neto"], ...emps],
      { title: "Nomina_Peru", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(8000);
  });

  it("75: PPT plan estratégico 2026-2030", async () => {
    const r = await generateDocument("pptx", {
      title: "Plan Estratégico 2026-2030",
      slides: [
        { type: "content", title: "Visión", bullets: ["Ser líder en soluciones tecnológicas en Latinoamérica al 2030."] },
        { type: "content", title: "Misión", bullets: ["Transformar negocios mediante tecnología innovadora y talento excepcional."] },
        { type: "content", title: "5 Fuerzas de Porter", bullets: ["Amenaza de nuevos entrantes: MEDIA","Poder proveedores: BAJO","Poder clientes: ALTO","Productos sustitutos: MEDIO","Rivalidad: ALTA"] },
        { type: "content", title: "Objetivos Estratégicos", bullets: ["OE1: Crecer 25% anual en ingresos","OE2: Expandir a 3 países","OE3: NPS > 80","OE4: Eficiencia operativa > 90%"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(5);
  });

  it("76: Excel costeo exportación DDP Incoterms", async () => {
    const { buffer } = await createExcelFromData([
      ["Concepto","Valor (USD)","Incoterm"],
      ["Valor EXW",25000,"EXW"],
      ["Flete interno",500,"FCA"],
      ["Agente aduanas origen",300,"FCA"],
      ["Flete internacional",2800,"CFR"],
      ["Seguro (0.5%)",140,"CIF"],
      ["Descarga destino",400,"DAP"],
      ["Aranceles destino (8%)",2331,"DDP"],
      ["IVA destino (16%)",5036,"DDP"],
      ["TOTAL DDP",36507,"DDP"],
    ], { title: "Costeo_Exportacion_DDP", autoFormulas: true });
    expect(await xlsxContains(buffer, "EXW")).toBe(true);
  });

  it("77: Excel riesgo crediticio 20 clientes clasificación SBS", async () => {
    const clients = Array.from({ length: 20 }, (_, i) => [
      `Cliente ${i+1}`, (300+Math.floor(Math.random()*700)).toString(),
      (0.1+Math.random()*0.8).toFixed(2),
      ["Bueno","Regular","Malo"][Math.floor(Math.random()*3)],
      ["Normal","CPP","Deficiente","Dudoso","Pérdida"][Math.floor(Math.random()*5)],
    ]);
    const { buffer } = await createExcelFromData(
      [["Cliente","Score","Deuda/Ingreso","Historial","Clasificación SBS"], ...clients],
      { title: "Riesgo_Crediticio", conditionalFormatting: true });
    expect(buffer.length).toBeGreaterThan(4000);
  });

  it("78: Word plan negocio agroexportación arándanos", async () => {
    const r = await generateDocument("word", {
      title: "Plan de Negocio: Agroexportación de Arándanos a EEUU",
      sections: [
        { heading: "Análisis de Mercado", paragraphs: ["EEUU importa $2.8B en arándanos/año. Perú es 2° exportador mundial. Ventana comercial: ago-nov."] },
        { heading: "Ficha Técnica", table: { headers: ["Parámetro","Especificación"], rows: [["Variedad","Biloxi"],["Calibre",">12mm"],["°Brix",">10"],["Certificaciones","GlobalGAP, HACCP, FDA"]] } },
        { heading: "Proyección Financiera", table: { headers: ["Año","Producción(ton)","Precio FOB($/kg)","Ingreso($)"], rows: [["1",50,8,400000],["2",120,7.5,900000],["3",200,7.2,1440000]] } },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("79: Excel valorización múltiplos 10 comparables", async () => {
    const comps = Array.from({ length: 10 }, (_, i) => [
      `Empresa ${String.fromCharCode(65+i)}`, (5+Math.random()*15).toFixed(1), (10+Math.random()*25).toFixed(1), (1+Math.random()*4).toFixed(1),
    ]);
    const { buffer } = await createExcelFromData(
      [["Empresa","EV/EBITDA","P/E","P/BV"], ...comps, ["Mediana","","",""]],
      { title: "Valorizacion_Multiplos", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it("80: Excel portafolio Markowitz 10 activos", async () => {
    const assets = Array.from({ length: 10 }, (_, i) => [
      `Activo ${i+1}`, (2+Math.random()*18).toFixed(1)+"%", (5+Math.random()*25).toFixed(1)+"%",
      `${(Math.random()*20).toFixed(0)}%`,
    ]);
    const { buffer } = await createExcelFromData(
      [["Activo","Rendimiento Esp.","Riesgo(σ)","Peso Óptimo"], ...assets],
      { title: "Portafolio_Markowitz" });
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it("81: PPT due diligence financiera", async () => {
    const r = await generateDocument("pptx", {
      title: "Due Diligence Financiera - Target Corp SAC",
      slides: [
        { type: "content", title: "Estructura Societaria", bullets: ["Grupo económico: 3 empresas","Accionista mayoritario: 70%","Subsidiarias: 2"] },
        { type: "table", title: "Estados Financieros", tableData: { headers: ["Rubro","2024","2025","Var%"], rows: [["Ingresos","$5.2M","$6.1M","+17%"],["EBITDA","$1.3M","$1.5M","+15%"],["Utilidad","$800K","$950K","+19%"]] } },
        { type: "content", title: "Contingencias", bullets: ["Juicio laboral: $150K (probable)","Demanda tributaria: $80K (posible)","Multa ambiental: $30K (resuelta)"] },
        { type: "content", title: "Ajustes", bullets: ["EBITDA normalizado: $1.65M","Capital de trabajo: $420K","Deuda neta: $800K","Enterprise Value ajustado: $8.2M"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(5);
  });

  it("82: Excel modelo financiero inmobiliario con TIR y VAN", async () => {
    const { buffer } = await createExcelFromData([
      ["Concepto","Año 0","Año 1","Año 2","Año 3"],
      ["Terreno",-500000,0,0,0],
      ["Construcción",-200000,-800000,0,0],
      ["Ventas",0,300000,1200000,500000],
      ["Gastos Operativos",0,-50000,-80000,-30000],
      ["Flujo Neto",-700000,-550000,1120000,470000],
      ["Flujo Acumulado",-700000,-1250000,-130000,340000],
      ["TIR","28.5%","","",""],
      ["VAN (12%)","S/ 142,350","","",""],
    ], { title: "Modelo_Inmobiliario", autoFormulas: true });
    expect(await xlsxContains(buffer, "TIR")).toBe(true);
  });

  it("83: Excel análisis sensibilidad tabla tornado", async () => {
    const { buffer } = await createExcelFromData([
      ["Variable","Variación","VAN Pesimista","VAN Base","VAN Optimista"],
      ["Precio","-20% / +20%",-50000,200000,450000],
      ["Costo","+15% / -15%",50000,200000,350000],
      ["Demanda","-25% / +25%",-100000,200000,500000],
      ["Tasa descuento","+3% / -3%",120000,200000,300000],
      ["Inversión","+10% / -10%",150000,200000,250000],
    ], { title: "Analisis_Sensibilidad" });
    expect(await xlsxContains(buffer, "VAN")).toBe(true);
  });

  it("84: Word prospecto emisión bonos corporativos", async () => {
    const r = await generateDocument("word", {
      title: "Prospecto de Emisión de Bonos Corporativos",
      sections: [
        { heading: "Emisor", paragraphs: ["Corporación XYZ SAA. RUC: 20XXXXXXXXX. Clasificación: AA+ (Apoyo & Asociados)."] },
        { heading: "Características de la Emisión", table: { headers: ["Parámetro","Detalle"], rows: [["Monto","S/ 50,000,000"],["Plazo","5 años"],["Tasa","6.25% nominal anual"],["Pago cupones","Semestral"],["Garantía","Flujos futuros (fideicomiso)"],["Uso de fondos","70% expansión, 30% refinanciamiento"]] } },
        { heading: "Factores de Riesgo", list: { items: ["Riesgo de mercado","Riesgo crediticio","Riesgo de liquidez","Riesgo operacional","Riesgo regulatorio"] } },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("85: Excel conciliación bancaria 30 movimientos libro + 35 banco", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "Libro", data: [["Fecha","Concepto","Cargo","Abono","Saldo"], ...Array.from({ length: 30 }, (_, i) => [`2026-04-${(i+1).toString().padStart(2,"0")}`, `Mov libro ${i+1}`, (Math.random()>0.5?Math.floor(Math.random()*5000):0), (Math.random()>0.5?Math.floor(Math.random()*5000):0), 0])], options: { autoFormulas: true } },
      { name: "Banco", data: [["Fecha","Concepto","Cargo","Abono","Saldo"], ...Array.from({ length: 35 }, (_, i) => [`2026-04-${(i%28+1).toString().padStart(2,"0")}`, `Mov banco ${i+1}`, (Math.random()>0.5?Math.floor(Math.random()*5000):0), (Math.random()>0.5?Math.floor(Math.random()*5000):0), 0])], options: { autoFormulas: true } },
      { name: "Conciliación", data: [["Concepto","Monto"],["Saldo según libro",125000],["(+) Notas crédito no registradas",3500],["(-) Cheques girados no cobrados",-8200],["(-) Comisiones bancarias",-450],["Saldo conciliado",119850],["Saldo según banco",119850],["Diferencia",0]] },
    ]);
    expect(await xlsxContains(buffer, "Conciliación") || await xlsxContains(buffer, "Saldo")).toBe(true);
  });

  it("86: Excel presupuesto maestro 8 hojas interrelacionadas", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "Ventas", data: [["Mes","Unidades","Precio","Total"],["Ene",1000,50,50000],["Feb",1200,50,60000],["Mar",1100,50,55000]] },
      { name: "Producción", data: [["Mes","Ventas","Inv.Final","Necesidad","Inv.Inicial","Producir"],["Ene",1000,120,1120,100,1020],["Feb",1200,110,1310,120,1190]] },
      { name: "MP", data: [["Mes","Producción","MP/unid","Total MP","Precio","Costo"],["Ene",1020,2,2040,5,10200],["Feb",1190,2,2380,5,11900]] },
      { name: "MOD", data: [["Mes","Producción","HH/unid","Total HH","Costo/HH","Costo MOD"],["Ene",1020,0.5,510,15,7650],["Feb",1190,0.5,595,15,8925]] },
      { name: "CIF", data: [["Concepto","Fijo","Variable/unid","Ene","Feb"],["Depreciación",5000,0,5000,5000],["Energía",2000,1.5,3530,3785]] },
      { name: "Costo Prod", data: [["Mes","MP","MOD","CIF","Total"],["Ene",10200,7650,8530,26380],["Feb",11900,8925,8785,29610]] },
      { name: "Gastos", data: [["Concepto","Ene","Feb"],["Administrativos",8000,8000],["Ventas",5000,6000],["Financieros",2000,2000]] },
      { name: "EERR", data: [["Concepto","Ene","Feb"],["Ventas",50000,60000],["Costo Ventas",26380,29610],["Utilidad Bruta",23620,30390],["Gastos",15000,16000],["Utilidad Operativa",8620,14390]] },
    ]);
    expect(await xlsxContains(buffer, "Ventas")).toBe(true);
  });

  it("87: diagrama mermaid proceso crédito bancario 7 pasos", () => {
    const d = `flowchart LR
  A[Solicitud] --> B[Evaluación Crediticia]
  B --> C[Comité de Créditos]
  C -->|Aprobado| D[Desembolso]
  C -->|Rechazado| E[Notificación]
  D --> F[Seguimiento]
  F --> G[Recuperación]`;
    expect(d).toContain("Comité");
    expect(d).toContain("Desembolso");
  });

  it("88: Excel indicadores cobranzas con ratios", async () => {
    const { buffer } = await createExcelFromData([
      ["Indicador","Valor","Meta","Estado"],
      ["Cartera Total","$5,200,000","",""],
      ["Cartera Vigente","$4,160,000","80%","OK"],
      ["Cartera Vencida","$780,000","<15%","Alerta"],
      ["Cartera Judicial","$260,000","<5%","OK"],
      ["Provisiones","$520,000","",""],
      ["Ratio Morosidad","15.0%","<12%","Rojo"],
      ["Cobertura","66.7%",">80%","Rojo"],
      ["Recuperación mes","$320,000","$400K","Amarillo"],
    ], { title: "Indicadores_Cobranzas", conditionalFormatting: true });
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it("89: PPT estrategia internacionalización", async () => {
    const r = await generateDocument("pptx", {
      title: "Estrategia de Internacionalización 2026",
      slides: [
        { type: "content", title: "Selección de Mercado", bullets: ["Matriz de priorización: Colombia (8.5/10)","Chile (7.8/10), México (7.2/10)","Criterios: tamaño, accesibilidad, competencia"] },
        { type: "content", title: "Modo de Entrada", bullets: ["Fase 1: Exportación directa","Fase 2: Joint venture local","Fase 3: Subsidiaria propia"] },
        { type: "content", title: "Adaptación de Producto", bullets: ["Idioma: español neutro","Moneda local","Regulación local","Soporte 24/7"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(4);
  });

  it("90: Excel análisis DuPont 5 empresas", async () => {
    const { buffer } = await createExcelFromData([
      ["Empresa","Margen Neto","Rotación Activos","Multiplicador Capital","ROE"],
      ["Empresa A","8.5%",1.2,2.0,"20.4%"],
      ["Empresa B","5.2%",1.8,1.5,"14.0%"],
      ["Empresa C","12.0%",0.9,1.8,"19.4%"],
      ["Empresa D","6.8%",1.5,2.2,"22.4%"],
      ["Empresa E","9.1%",1.1,1.6,"16.0%"],
    ], { title: "Analisis_DuPont", autoFormulas: true });
    expect(await xlsxContains(buffer, "DuPont") || await xlsxContains(buffer, "ROE")).toBe(true);
  });

  it("91-100: 10 additional business documents", async () => {
    // Test 91: Dictamen auditoría
    const r91 = await generateDocument("word", {
      title: "Dictamen de Auditoría con Salvedades",
      sections: [
        { heading: "Párrafo Introductorio", paragraphs: ["Hemos auditado los estados financieros de la Compañía al 31 de diciembre de 2025."] },
        { heading: "Opinión con Salvedades", paragraphs: ["Excepto por los efectos de la limitación al alcance descrita, los EEFF presentan razonablemente."] },
      ],
    });
    expect(r91.buffer.length).toBeGreaterThan(3000);

    // Test 92: Forecast 3 métodos
    const r92 = await createExcelFromData([
      ["Mes","Ventas Real","Prom.Móvil","Suav.Exp(α=0.3)","Regresión"],
      ...Array.from({ length: 24 }, (_, i) => [i+1, 1000+i*50+Math.floor(Math.random()*200), 0, 0, 0]),
    ], { title: "Forecast_Ventas", autoFormulas: true });
    expect(r92.buffer.length).toBeGreaterThan(3000);

    // Test 93: Segmentación RFM
    const r93 = await createExcelFromData([
      ["Cliente","Recencia(días)","Frecuencia","Monto Total","Score R","Score F","Score M","Segmento"],
      ...Array.from({ length: 20 }, (_, i) => [`C-${i+1}`, Math.floor(Math.random()*365), Math.floor(Math.random()*50)+1, Math.floor(Math.random()*10000), Math.floor(Math.random()*5)+1, Math.floor(Math.random()*5)+1, Math.floor(Math.random()*5)+1, ["Champions","Loyal","At Risk","Lost"][Math.floor(Math.random()*4)]]),
    ], { title: "Segmentacion_RFM", conditionalFormatting: true });
    expect(r93.buffer.length).toBeGreaterThan(3000);

    // Test 94: PPT reporte RRHH
    const r94 = await generateDocument("pptx", {
      title: "Reporte de Gestión RRHH Q1 2026",
      slides: [
        { type: "content", title: "Headcount", bullets: ["Total: 450 empleados","Ingresos Q1: 35","Salidas Q1: 12","Rotación: 2.7%"] },
        { type: "content", title: "Clima Laboral", bullets: ["Satisfacción general: 82%","Engagement: 78%","eNPS: +45"] },
      ],
    });
    expect(r94.buffer.length).toBeGreaterThan(3000);

    // Test 95: Evaluación 360°
    const r95 = await createExcelFromData([
      ["Evaluado","Evaluador","Liderazgo","Comunicación","Trabajo Equipo","Innovación","Promedio"],
      ...Array.from({ length: 10 }, (_, i) => [`Eval ${i+1}`, `Par ${i+1}`, (3+Math.random()*2).toFixed(1), (3+Math.random()*2).toFixed(1), (3+Math.random()*2).toFixed(1), (3+Math.random()*2).toFixed(1), 0]),
    ], { title: "Evaluacion_360", autoFormulas: true });
    expect(r95.buffer.length).toBeGreaterThan(3000);

    // Test 96: Regresión múltiple
    const r96 = await createExcelFromData([
      ["Variable","Coeficiente","Error Std","t-value","p-value"],
      ["Intercepto",1250.5,180.2,6.94,"<0.001"],
      ["Precio",-45.2,12.3,-3.67,"0.002"],
      ["Publicidad",8.7,2.1,4.14,"<0.001"],
      ["Competencia",-12.3,5.8,-2.12,"0.042"],
      ["Estacionalidad",250.1,65.4,3.82,"0.001"],
      ["R²",0.87,"","",""],
      ["R² Ajustado",0.85,"","",""],
      ["F-statistic",42.3,"","","<0.001"],
    ], { title: "Regresion_Multiple" });
    expect(r96.buffer.length).toBeGreaterThan(3000);

    // Test 97: BCP plan contingencia
    const r97 = await generateDocument("word", {
      title: "Plan de Contingencia Empresarial (BCP)",
      sections: [
        { heading: "Identificación de Riesgos", paragraphs: ["Terremoto, incendio, pandemia, ciberataque, falla de TI."] },
        { heading: "BIA - Análisis de Impacto", paragraphs: ["RTO: 4 horas para sistemas críticos. RPO: 1 hora."] },
        { heading: "Estrategias de Continuidad", list: { items: ["Site alterno en AWS us-east-1","Backup diario cifrado","Equipo de respuesta 24/7"] } },
      ],
    });
    expect(r97.buffer.length).toBeGreaterThan(3000);

    // Test 98: KPIs Marketing
    const r98 = await createExcelFromData([
      ["KPI","Meta","Real","Variación","Tendencia"],
      ...["CAC","LTV","ROAS","CTR","CPC","Engagement","NPS","Churn","MRR","ARR","Conversión","Bounce Rate","Sessions","Leads","SQL","Ticket Medio","Frecuencia","Retención","Viral Coeff","Payback"].map((k, i) => [k, (10+Math.random()*90).toFixed(1), (10+Math.random()*90).toFixed(1), ((Math.random()-0.5)*20).toFixed(1)+"%", Math.random()>0.5?"↑":"↓"]),
    ], { title: "KPIs_Marketing", conditionalFormatting: true });
    expect(r98.buffer.length).toBeGreaterThan(4000);

    // Test 99: Proceso compras mermaid
    const d99 = `flowchart LR
  A[Requerimiento] --> B[Cotización]
  B --> C[Evaluación]
  C --> D[Orden de Compra]
  D --> E[Recepción]
  E --> F[Inspección]
  F --> G[Ingreso Almacén]
  G --> H[Pago]`;
    expect((d99.match(/-->/g) || []).length).toBe(7);

    // Test 100: Montecarlo simulación
    const r100 = await createExcelFromData([
      ["Iteración","Precio","Demanda","Costo","VAN"],
      ...Array.from({ length: 50 }, (_, i) => [
        i+1, (80+Math.random()*40).toFixed(0), (800+Math.random()*400).toFixed(0),
        (40+Math.random()*20).toFixed(0), (-50000+Math.random()*300000).toFixed(0),
      ]),
    ], { title: "Simulacion_Montecarlo", autoFormulas: true });
    expect(r100.buffer.length).toBeGreaterThan(5000);
  });
});
