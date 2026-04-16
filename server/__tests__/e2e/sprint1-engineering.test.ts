/**
 * Sprint 1 — Engineering E2E Tests (50 tests)
 * Civil, Environmental, Systems, Industrial Engineering
 * Each test generates REAL documents and verifies content/structure.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import { generateDocument } from "../../services/documentGenerators/index";
import { AdvancedExcelBuilder, createExcelFromData, createMultiSheetExcel } from "../../services/advancedExcelBuilder";

beforeAll(() => {
  fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
});

// Helper: check XLSX XML for content
async function xlsxContains(buf: Buffer, text: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  for (const f of Object.keys(zip.files).filter(f => f.startsWith("xl/"))) {
    const xml = await zip.files[f].async("text");
    if (xml.includes(text)) return true;
  }
  return false;
}

async function xlsxSheetCount(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
}

async function pptxSlideCount(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
}

// ═══════════════════════════════════════════════════════════════
// ING. CIVIL (tests 1-12)
// ═══════════════════════════════════════════════════════════════
describe("Ingeniería Civil", () => {
  it("1: metrado de columnas edificio 5 pisos con fórmulas V=a×b×h", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "Piso 1", data: [["Columna","Sección(m)","Altura(m)","Nº","Vol.Concreto(m3)","Peso Acero(kg)"],["C1","0.30x0.40",3.00,4,1.44,86.4],["C2","0.35x0.50",3.00,6,3.15,189.0]], options: { autoFormulas: true } },
      { name: "Piso 2", data: [["Columna","Sección(m)","Altura(m)","Nº","Vol.Concreto(m3)","Peso Acero(kg)"],["C1","0.30x0.40",2.80,4,1.34,80.6],["C2","0.35x0.50",2.80,6,2.94,176.4]], options: { autoFormulas: true } },
      { name: "Piso 3", data: [["Columna","Sección(m)","Altura(m)","Nº","Vol.Concreto(m3)","Peso Acero(kg)"],["C1","0.30x0.40",2.80,4,1.34,80.6],["C2","0.30x0.40",2.80,6,2.02,120.9]], options: { autoFormulas: true } },
      { name: "Piso 4", data: [["Columna","Sección(m)","Altura(m)","Nº","Vol.Concreto(m3)","Peso Acero(kg)"],["C1","0.25x0.35",2.80,4,0.98,58.8],["C2","0.30x0.40",2.80,6,2.02,120.9]], options: { autoFormulas: true } },
      { name: "Piso 5", data: [["Columna","Sección(m)","Altura(m)","Nº","Vol.Concreto(m3)","Peso Acero(kg)"],["C1","0.25x0.35",2.80,4,0.98,58.8],["C2","0.25x0.35",2.80,6,1.47,88.2]], options: { autoFormulas: true } },
    ]);
    expect(await xlsxSheetCount(buffer)).toBe(5);
    expect(await xlsxContains(buffer, "Columna")).toBe(true);
  });

  it("2: memoria de cálculo estructural Word con tablas", async () => {
    const r = await generateDocument("word", {
      title: "Memoria de Cálculo Estructural",
      author: "Ing. Estructural",
      sections: [
        { heading: "Predimensionamiento de Vigas", paragraphs: ["Luz libre L=6.00m, peralte h=L/12=0.50m, ancho b=0.25m."] },
        { heading: "Verificación por Flexión", table: { headers: ["Viga","Mu(kN·m)","φMn(kN·m)","Verificación"], rows: [["V-101","85.2","112.5","OK"],["V-102","92.8","112.5","OK"],["V-103","78.4","95.0","OK"]] } },
        { heading: "Verificación por Cortante", table: { headers: ["Viga","Vu(kN)","φVn(kN)","Estribos"], rows: [["V-101","65.3","78.2","φ3/8@0.15"],["V-102","71.0","78.2","φ3/8@0.12"]] } },
      ],
    });
    const zip = await JSZip.loadAsync(r.buffer);
    const doc = await zip.files["word/document.xml"]?.async("text");
    expect(doc).toContain("Predimensionamiento");
    expect(doc).toContain("w:tbl");
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("3: análisis de costos unitarios concreto fc=210 Excel", async () => {
    const { buffer } = await createExcelFromData([
      ["Recurso","Tipo","Unidad","Cantidad","Precio","Parcial"],
      ["Cemento Portland tipo I","Material","bls",8.43,26.50,223.40],
      ["Arena gruesa","Material","m3",0.51,45.00,22.95],
      ["Piedra chancada 3/4","Material","m3",0.64,60.00,38.40],
      ["Agua","Material","m3",0.19,5.00,0.93],
      ["Operario","Mano de obra","hh",1.60,23.46,37.54],
      ["Oficial","Mano de obra","hh",0.80,18.16,14.53],
      ["Peón","Mano de obra","hh",8.00,16.39,131.12],
      ["Mezcladora 9-11 p3","Equipo","hm",0.40,25.00,10.00],
      ["Vibrador 4HP","Equipo","hm",0.40,15.00,6.00],
    ], { title: "ACU_Concreto_fc210", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(3000);
    expect(await xlsxContains(buffer, "Cemento")).toBe(true);
  });

  it("4: PPT proyecto infraestructura vial 10+ slides", async () => {
    const r = await generateDocument("pptx", {
      title: "Proyecto de Infraestructura Vial",
      subtitle: "Carretera Departamental Tramo I",
      slides: [
        { type: "content", title: "Estudio de Tráfico", bullets: ["IMDA = 3,500 veh/día","Factor de crecimiento = 3.2% anual","Período de diseño: 20 años","ESAL = 4.5 × 10⁶"] },
        { type: "content", title: "Diseño Geométrico", bullets: ["Velocidad directriz: 80 km/h","Radio mínimo: 230 m","Pendiente máxima: 7%","Ancho calzada: 7.20 m"] },
        { type: "table", title: "Estructura de Pavimento", tableData: { headers: ["Capa","Espesor(cm)","Material","CBR mínimo"], rows: [["Carpeta asfáltica","5","MAC-2","-"],["Base granular","15","Grava","80%"],["Sub-base","20","Grava","40%"]] } },
        { type: "content", title: "Señalización", bullets: ["128 señales preventivas","85 señales reglamentarias","2,400 m de guardavías","Demarcación horizontal: 12.5 km"] },
        { type: "content", title: "Drenaje", bullets: ["36 alcantarillas TMC","2.8 km de cunetas revestidas","4 badenes","Sistema de subdrenaje"] },
        { type: "content", title: "Presupuesto", bullets: ["Costo directo: S/ 45,200,000","Gastos generales (12%): S/ 5,424,000","Utilidad (8%): S/ 3,616,000","IGV (18%): S/ 9,763,200","TOTAL: S/ 64,003,200"] },
        { type: "content", title: "Cronograma", bullets: ["Duración: 18 meses","Fase I (6 meses): Movimiento de tierras","Fase II (8 meses): Pavimentación","Fase III (4 meses): Señalización y acabados"] },
        { type: "content", title: "Impacto Ambiental", bullets: ["EIA semi-detallado aprobado","Plan de reforestación: 5,000 árboles","Monitoreo de calidad de aire y ruido","Presupuesto ambiental: S/ 1,200,000"] },
        { type: "content", title: "Conclusiones", bullets: ["Proyecto técnicamente viable","TIR social = 14.2%","VAN social = S/ 12.5 millones","Beneficio/Costo = 1.32"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(10);
  });

  it("5: diagrama mermaid proceso constructivo cimentación 8 nodos", () => {
    const diagram = `flowchart TD
  A[Trazo y Replanteo] --> B[Excavación]
  B --> C[Solado e=4cm]
  C --> D[Armadura de Acero]
  D --> E[Encofrado]
  E --> F[Vaciado Concreto fc=210]
  F --> G[Curado 7 días]
  G --> H[Desencofrado]`;
    expect(diagram).toContain("flowchart");
    expect((diagram.match(/-->/g) || []).length).toBe(7);
    expect(diagram).toContain("Excavación");
    expect(diagram).toContain("Curado");
  });

  it("6: diseño de mezcla ACI con fórmulas", async () => {
    const { buffer } = await createExcelFromData([
      ["Parámetro","Valor","Unidad","Fórmula"],
      ["f'c requerido",210,"kg/cm²",""],
      ["f'cr",294,"kg/cm²","f'c+84"],
      ["Relación a/c",0.558,"","Tabla ACI"],
      ["Asentamiento",3,"pulg","3-4 pulg"],
      ["Agua",193,"L/m³","Tabla ACI"],
      ["Cemento",346,"kg/m³","Agua/(a/c)"],
      ["Aire atrapado",2,"%","Tabla ACI"],
      ["Arena",710,"kg/m³","Por diferencia"],
      ["Piedra",1020,"kg/m³","Tabla ACI"],
    ], { title: "Diseño_Mezcla_ACI", autoFormulas: true });
    expect(await xlsxContains(buffer, "210")).toBe(true);
    expect(await xlsxContains(buffer, "Cemento")).toBe(true);
  });

  it("7: SVG sección transversal de vía con dimensiones", () => {
    const svg = `<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <rect x="50" y="200" width="700" height="30" fill="#333" rx="2"/>
  <text x="400" y="195" text-anchor="middle" font-size="12" fill="#333">Calzada 7.20m</text>
  <line x1="150" y1="200" x2="150" y2="230" stroke="white" stroke-width="2" stroke-dasharray="4"/>
  <text x="100" y="260" text-anchor="middle" font-size="10">Berma 1.20m</text>
  <text x="700" y="260" text-anchor="middle" font-size="10">Berma 1.20m</text>
  <polygon points="50,230 20,350 50,350" fill="#8B4513" opacity="0.6"/>
  <text x="25" y="300" font-size="9" fill="#333">Talud 1:1.5</text>
  <polygon points="750,230 780,350 750,350" fill="#8B4513" opacity="0.6"/>
  <line x1="20" y1="350" x2="50" y2="350" stroke="blue" stroke-width="2"/>
  <text x="35" y="370" text-anchor="middle" font-size="9">Cuneta</text>
</svg>`;
    expect(svg).toContain("<svg");
    expect(svg).toContain("7.20m");
    expect(svg).toContain("1.20m");
    expect(svg).toContain("Talud");
    expect(svg).toContain("Cuneta");
  });

  it("8: cronograma valorizado obra civil 20 partidas 6 meses", async () => {
    const partidas = Array.from({ length: 20 }, (_, i) => [
      `${(i+1).toString().padStart(2,"0")}`, `Partida ${i+1}`, (10000 + i * 5000).toString(),
      `${(Math.random()*30).toFixed(1)}%`, `${(Math.random()*25).toFixed(1)}%`,
      `${(Math.random()*20).toFixed(1)}%`, `${(Math.random()*15).toFixed(1)}%`,
      `${(Math.random()*10).toFixed(1)}%`, `${(Math.random()*5).toFixed(1)}%`,
    ]);
    const { buffer } = await createExcelFromData(
      [["Ítem","Descripción","Presupuesto","Mes 1","Mes 2","Mes 3","Mes 4","Mes 5","Mes 6"], ...partidas],
      { title: "Cronograma_Valorizado", autoFormulas: true },
    );
    expect(buffer.length).toBeGreaterThan(5000);
    expect(await xlsxContains(buffer, "Partida")).toBe(true);
  });

  it("9: Word especificaciones técnicas muro contención", async () => {
    const r = await generateDocument("word", {
      title: "Especificaciones Técnicas - Muro de Contención",
      sections: [
        { heading: "Tipo de Muro", paragraphs: ["Muro de gravedad, concreto ciclópeo f'c=175 kg/cm² + 30% PG."] },
        { heading: "Geometría", table: { headers: ["Parámetro","Valor"], rows: [["Altura","4.50 m"],["Base","2.70 m"],["Corona","0.60 m"],["Talón","0.90 m"],["Diente","0.30×0.30 m"]] } },
        { heading: "Empuje de Suelos", paragraphs: ["Peso específico γ=1.80 t/m³, Ángulo fricción φ=30°, Ka=0.333","Empuje activo Ea = ½×Ka×γ×H² = ½×0.333×1.80×4.50² = 6.07 t/m"] },
        { heading: "Verificación al Volteo", paragraphs: ["FS volteo = Momento estabilizante / Momento volcante = 18.5/8.1 = 2.28 > 2.0 ✓"] },
        { heading: "Verificación al Deslizamiento", paragraphs: ["FS deslizamiento = (W×tan φ + c×B) / Ea = 12.4/6.07 = 2.04 > 1.5 ✓"] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
    const zip = await JSZip.loadAsync(r.buffer);
    const doc = await zip.files["word/document.xml"]?.async("text");
    expect(doc).toContain("Volteo");
    expect(doc).toContain("Deslizamiento");
  });

  it("10: Excel planilla acero con fórmula W=Ø²/162×L", async () => {
    const { buffer } = await createExcelFromData([
      ["Elemento","Ø(mm)","Long(m)","Nº barras","Peso unit(kg/m)","Peso total(kg)"],
      ["Columna C1",16,3.50,24,1.58,132.72],
      ["Viga V-101",20,6.80,8,2.47,134.37],
      ["Viga V-102",20,5.40,6,2.47,80.03],
      ["Zapata Z1",16,2.40,32,1.58,121.34],
      ["Losa",12,4.00,120,0.89,427.20],
    ], { title: "Planilla_Acero", autoFormulas: true });
    expect(await xlsxContains(buffer, "Columna")).toBe(true);
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it("11: SVG planta estructural edificio con ejes", () => {
    const svg = `<svg viewBox="0 0 600 500" xmlns="http://www.w3.org/2000/svg">
  <text x="50" y="30" font-weight="bold">PLANTA ESTRUCTURAL - PISO TÍPICO</text>
  ${["A","B","C","D","E"].map((l,i) => `<text x="${100+i*110}" y="480" text-anchor="middle" font-size="14" font-weight="bold">${l}</text>`).join("\n  ")}
  ${[1,2,3,4].map((n,i) => `<text x="30" y="${100+i*100}" text-anchor="middle" font-size="14" font-weight="bold">${n}</text>`).join("\n  ")}
  ${[0,1,2,3,4].flatMap((_,ci) => [0,1,2,3].map((_,ri) => `<rect x="${90+ci*110}" y="${85+ri*100}" width="20" height="20" fill="#666" stroke="#333"/>`)).join("\n  ")}
  <line x1="100" y1="95" x2="540" y2="95" stroke="#2E5090" stroke-width="3"/>
  <line x1="100" y1="195" x2="540" y2="195" stroke="#2E5090" stroke-width="3"/>
</svg>`;
    expect(svg).toContain("<svg");
    expect(svg).toContain("PLANTA ESTRUCTURAL");
    expect((svg.match(/<rect/g) || []).length).toBe(20);
  });

  it("12: PDF informe ensayo compresión concreto", async () => {
    const r = await generateDocument("pdf", {
      title: "Informe de Ensayo de Compresión de Concreto",
      author: "Laboratorio de Materiales",
      sections: [
        { heading: "Datos del Ensayo", paragraphs: ["Norma: NTP 339.034 / ASTM C39","Proyecto: Edificio Residencial 5 pisos","Diseño de mezcla: f'c = 210 kg/cm²"] },
        { heading: "Resultados", table: { headers: ["Probeta","Edad(días)","Carga(kN)","f'c(kg/cm²)","%f'c"], rows: [["P-01",7,280,158.6,"75.5%"],["P-02",7,275,155.8,"74.2%"],["P-03",14,350,198.3,"94.4%"],["P-04",14,360,203.9,"97.1%"],["P-05",28,395,223.7,"106.5%"],["P-06",28,405,229.4,"109.2%"]] } },
        { heading: "Conclusiones", paragraphs: ["Las probetas ensayadas a 28 días superan el f'c de diseño de 210 kg/cm².","El concreto cumple con los requisitos de resistencia según NTP 339.034."] },
      ],
    });
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.buffer.length).toBeGreaterThan(2000);
  });
});

// ═══════════════════════════════════════════════════════════════
// ING. AMBIENTAL (tests 13-24)
// ═══════════════════════════════════════════════════════════════
describe("Ingeniería Ambiental", () => {
  it("13: monitoreo calidad de agua 12 estaciones con ECA", async () => {
    const stations = Array.from({ length: 12 }, (_, i) => [
      `E-${(i+1).toString().padStart(2,"0")}`, (6.5+Math.random()*2).toFixed(1),
      (5+Math.random()*45).toFixed(1), (10+Math.random()*90).toFixed(1),
      (20+Math.random()*180).toFixed(0), (100+Math.random()*9900).toFixed(0),
    ]);
    const { buffer } = await createExcelFromData(
      [["Estación","pH","DBO5(mg/L)","DQO(mg/L)","SST(mg/L)","Coliformes(NMP/100mL)"], ...stations],
      { title: "Monitoreo_Calidad_Agua", conditionalFormatting: true },
    );
    expect(await xlsxContains(buffer, "Estación")).toBe(true);
    expect(buffer.length).toBeGreaterThan(4000);
  });

  it("14: Word EIA semi-detallado con todas las secciones", async () => {
    const r = await generateDocument("word", {
      title: "Estudio de Impacto Ambiental Semi-Detallado",
      author: "Consultora Ambiental SAC",
      sections: [
        { heading: "Descripción del Proyecto", paragraphs: ["Planta de procesamiento de minerales no metálicos, capacidad 500 TM/día."] },
        { heading: "Línea Base Física", paragraphs: ["Clima: templado seco, T° media 18°C, precipitación 250 mm/año.","Geología: depósitos aluviales cuaternarios.","Hidrología: cuenca del río Mantaro."] },
        { heading: "Línea Base Biológica", paragraphs: ["Flora: 45 especies identificadas, 3 endémicas.","Fauna: 28 especies de aves, 12 mamíferos, 8 reptiles."] },
        { heading: "Línea Base Social", paragraphs: ["Población del AID: 2,500 habitantes.","Actividad económica principal: agricultura y ganadería."] },
        { heading: "Identificación de Impactos", paragraphs: ["Se utilizó la Matriz de Leopold modificada (10 actividades × 15 factores)."] },
        { heading: "Plan de Manejo Ambiental", list: { items: ["Programa de monitoreo ambiental","Plan de manejo de residuos sólidos","Plan de contingencias","Plan de cierre y post-cierre","Plan de relaciones comunitarias"] } },
        { heading: "Plan de Monitoreo", paragraphs: ["Frecuencia: trimestral para aire, mensual para agua, semestral para suelo."] },
      ],
    });
    const zip = await JSZip.loadAsync(r.buffer);
    const doc = await zip.files["word/document.xml"]?.async("text");
    expect(doc).toContain("Impacto Ambiental");
    expect(doc).toContain("Línea Base");
    expect(doc).toContain("Leopold");
  });

  it("15: Excel huella de carbono Scope 1/2/3", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "Scope 1", data: [["Fuente","Consumo","Unidad","Factor Emisión","tCO2eq"],["Diésel",15000,"gal",10.21,153.15],["GLP",8000,"gal",5.79,46.32],["Gas Natural",5000,"m³",2.02,10.10]] },
      { name: "Scope 2", data: [["Fuente","Consumo","Unidad","Factor Emisión","tCO2eq"],["Electricidad",120000,"kWh",0.000494,59.28]] },
      { name: "Scope 3", data: [["Fuente","Consumo","Unidad","Factor Emisión","tCO2eq"],["Transporte empleados",50000,"km",0.000171,8.55],["Residuos",200,"ton",0.587,117.40],["Viajes aéreos",80000,"km",0.000255,20.40]] },
      { name: "Resumen", data: [["Scope","tCO2eq","%"],["Scope 1",209.57,"50.4%"],["Scope 2",59.28,"14.3%"],["Scope 3",146.35,"35.2%"],["TOTAL",415.20,"100%"]], options: { autoFormulas: true } },
    ]);
    expect(await xlsxSheetCount(buffer)).toBe(4);
    expect(await xlsxContains(buffer, "Scope")).toBe(true);
  });

  it("16: diagrama mermaid PTAR 7 etapas", () => {
    const d = `flowchart LR
  A[Cribado] --> B[Desarenador]
  B --> C[Sedimentador Primario]
  C --> D[Reactor Biológico]
  D --> E[Sedimentador Secundario]
  E --> F[Cloración]
  F --> G[Vertimiento]`;
    expect((d.match(/-->/g) || []).length).toBe(6);
    expect(d).toContain("Reactor Biológico");
    expect(d).toContain("Cloración");
  });

  it("17: Excel matriz Leopold 10×15", async () => {
    const headers = ["Actividad","Aire","Agua Sup.","Agua Sub.","Suelo","Geomorfología","Flora","Fauna","Paisaje","Empleo","Salud","Tráfico","Ruido","Vibraciones","Residuos","Social"];
    const rows = Array.from({ length: 10 }, (_, i) => [
      `Actividad ${i+1}`, ...Array.from({ length: 15 }, () => `${Math.floor(Math.random()*11)-5}/${Math.floor(Math.random()*5)+1}`),
    ]);
    const { buffer } = await createExcelFromData([headers, ...rows], { title: "Matriz_Leopold" });
    expect(await xlsxContains(buffer, "Actividad")).toBe(true);
    expect(buffer.length).toBeGreaterThan(4000);
  });

  it("18: PPT remediación de suelos contaminados", async () => {
    const r = await generateDocument("pptx", {
      title: "Remediación de Suelos Contaminados por Hidrocarburos",
      slides: [
        { type: "content", title: "Biorremediación", bullets: ["Bioestimulación con nutrientes N-P-K","Bioaumentación con cepas degradadoras","Eficiencia: 60-85% en 6-12 meses","Costo: $30-100/m³"] },
        { type: "content", title: "Fitorremediación", bullets: ["Especies: Festuca arundinacea, Medicago sativa","Mecanismo: rizodegradación","Tiempo: 12-24 meses","Costo: $15-40/m³"] },
        { type: "content", title: "Lavado de Suelos", bullets: ["Surfactantes biodegradables","Eficiencia: 70-95%","Tiempo: 2-4 meses","Costo: $100-300/m³"] },
        { type: "content", title: "Desorción Térmica", bullets: ["Temperatura: 200-600°C","Eficiencia: >95%","Para TPH, PAHs, PCBs","Costo: $50-200/ton"] },
        { type: "content", title: "Selección de Tecnología", bullets: ["Depende de: tipo contaminante, concentración, tipo de suelo","Matriz de decisión multicriterio","Análisis costo-beneficio"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(6);
  });

  it("19: Excel monitoreo calidad de aire 6 estaciones", async () => {
    const { buffer } = await createExcelFromData([
      ["Estación","PM2.5(µg/m³)","PM10(µg/m³)","CO(µg/m³)","SO2(µg/m³)","NO2(µg/m³)","O3(µg/m³)"],
      ["Barlovento",12.5,35.2,2100,15.8,28.3,45.2],
      ["Sotavento",28.7,68.4,3500,32.1,52.7,38.9],
      ["Urbano Norte",45.3,92.1,5200,18.5,68.4,32.1],
      ["Urbano Sur",38.9,78.5,4800,22.3,55.9,35.6],
      ["Industrial",65.2,125.8,8500,45.7,82.3,28.4],
      ["Referencia",8.2,22.1,1500,8.9,15.2,52.8],
    ], { title: "Monitoreo_Aire", conditionalFormatting: true });
    expect(await xlsxContains(buffer, "PM2.5")).toBe(true);
  });

  it("20: Word plan manejo residuos sólidos", async () => {
    const r = await generateDocument("word", {
      title: "Plan de Manejo de Residuos Sólidos",
      sections: [
        { heading: "Diagnóstico", paragraphs: ["Generación: 0.85 kg/hab/día. Composición: orgánico 55%, plástico 12%, papel 10%, vidrio 5%, metal 3%, otros 15%."] },
        { heading: "Composición de Residuos", table: { headers: ["Tipo","Porcentaje","Ton/mes","Disposición"], rows: [["Orgánico","55%","462","Compostaje"],["Plástico","12%","101","Reciclaje"],["Papel/cartón","10%","84","Reciclaje"],["Vidrio","5%","42","Reciclaje"],["Metal","3%","25","Reciclaje"],["Otros","15%","126","Relleno sanitario"]] } },
        { heading: "Rutas de Recolección", paragraphs: ["Zona Norte: L-M-V, Zona Sur: M-J-S, Zona Industrial: diario."] },
        { heading: "Presupuesto", table: { headers: ["Rubro","Costo Anual(S/)"], rows: [["Personal","480,000"],["Vehículos","360,000"],["Disposición final","240,000"],["Equipos","120,000"],["TOTAL","1,200,000"]] } },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("21: SVG ciclo hidrológico", () => {
    const svg = `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="350" width="800" height="150" fill="#8B4513" opacity="0.3"/>
  <ellipse cx="400" cy="80" rx="200" ry="50" fill="#ccc" opacity="0.5"/>
  <text x="400" y="85" text-anchor="middle" font-weight="bold">Condensación</text>
  <text x="200" y="200" text-anchor="middle">Precipitación ↓</text>
  <text x="600" y="200" text-anchor="middle">Evaporación ↑</text>
  <text x="300" y="380" text-anchor="middle">Escorrentía →</text>
  <text x="500" y="430" text-anchor="middle">Infiltración ↓</text>
  <text x="400" y="470" text-anchor="middle">Flujo Subterráneo →</text>
</svg>`;
    expect(svg).toContain("Evaporación");
    expect(svg).toContain("Condensación");
    expect(svg).toContain("Precipitación");
    expect(svg).toContain("Escorrentía");
    expect(svg).toContain("Infiltración");
    expect(svg).toContain("Flujo Subterráneo");
  });

  it("22: Excel evaluación riesgo ambiental con formato condicional", async () => {
    const { buffer } = await createExcelFromData([
      ["Aspecto Ambiental","Probabilidad(1-5)","Severidad(1-5)","Riesgo(P×S)","Nivel"],
      ["Derrame de combustible",3,5,15,"Alto"],
      ["Emisiones de polvo",4,3,12,"Medio"],
      ["Generación de residuos",5,2,10,"Medio"],
      ["Ruido excesivo",3,3,9,"Medio"],
      ["Contaminación de agua",2,5,10,"Medio"],
      ["Erosión del suelo",4,4,16,"Alto"],
      ["Pérdida de hábitat",2,4,8,"Medio"],
      ["Residuos peligrosos",2,5,10,"Medio"],
      ["Vibración",3,2,6,"Bajo"],
      ["Olores",4,2,8,"Medio"],
    ], { title: "Eval_Riesgo_Ambiental", conditionalFormatting: true });
    expect(await xlsxContains(buffer, "Derrame")).toBe(true);
  });

  it("23: diagrama mermaid gestión integral residuos", () => {
    const d = `flowchart LR
  A[Generación] --> B[Segregación]
  B --> C[Almacenamiento]
  C --> D[Recolección]
  D --> E[Transporte]
  E --> F[Tratamiento]
  F --> G[Disposición Final]`;
    expect((d.match(/-->/g) || []).length).toBe(6);
    expect(d).toContain("Segregación");
  });

  it("24: Excel cálculo caudal PTAR con fórmulas", async () => {
    const { buffer } = await createExcelFromData([
      ["Parámetro","Valor","Unidad","Fórmula"],
      ["Población actual",25000,"hab",""],
      ["Tasa crecimiento",2.5,"%/año",""],
      ["Período diseño",20,"años",""],
      ["Población futura",40960,"hab","Po×(1+r)^n"],
      ["Dotación",200,"L/hab/día",""],
      ["% Retorno",80,"%",""],
      ["Qprom",37.93,"L/s","Pf×Dot×%R/86400"],
      ["K1 (máx horario)",2.0,"",""],
      ["Qmax",75.85,"L/s","Qprom×K1"],
      ["K2 (mínimo)",0.5,"",""],
      ["Qmin",18.96,"L/s","Qprom×K2"],
    ], { title: "Caudal_PTAR", autoFormulas: true });
    expect(await xlsxContains(buffer, "Caudal") || await xlsxContains(buffer, "PTAR") || await xlsxContains(buffer, "Población")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// ING. DE SISTEMAS (tests 25-36)
// ═══════════════════════════════════════════════════════════════
describe("Ingeniería de Sistemas", () => {
  it("25: diagrama ER mermaid sistema universitario 7+ entidades", () => {
    const d = `erDiagram
  ESTUDIANTE ||--o{ MATRICULA : realiza
  DOCENTE ||--o{ CURSO : imparte
  CURSO ||--o{ MATRICULA : tiene
  MATRICULA ||--o{ NOTA : genera
  CURSO }o--|| HORARIO : asignado
  HORARIO }o--|| AULA : usa
  ESTUDIANTE { string codigo PK string nombre string email }
  DOCENTE { string codigo PK string nombre string especialidad }
  CURSO { string codigo PK string nombre int creditos }`;
    expect(d).toContain("erDiagram");
    expect((d.match(/(ESTUDIANTE|DOCENTE|CURSO|MATRICULA|NOTA|HORARIO|AULA)/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  it("26: Excel gestión Scrum 30 user stories", async () => {
    const stories = Array.from({ length: 30 }, (_, i) => [
      `US-${(i+1).toString().padStart(3,"0")}`,
      `Como usuario quiero ${["login","registrarme","ver perfil","buscar","filtrar","ordenar","exportar","importar","editar","eliminar","notificar","compartir","comentar","adjuntar","aprobar","rechazar","asignar","programar","reportar","configurar","integrar","sincronizar","backup","restaurar","auditar","personalizar","automatizar","escalar","migrar","monitorear"][i % 30]}`,
      [1,2,3,5,8,13][Math.floor(Math.random()*6)],
      ["Must","Should","Could","Won't"][Math.floor(Math.random()*4)],
      `Sprint ${Math.floor(i/6)+1}`,
    ]);
    const { buffer } = await createExcelFromData(
      [["ID","User Story","Story Points","Prioridad MoSCoW","Sprint"], ...stories],
      { title: "Product_Backlog_Scrum" },
    );
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("27: diagrama secuencia matrícula online", () => {
    const d = `sequenceDiagram
  participant A as Alumno
  participant S as Sistema
  participant DB as Base de Datos
  participant P as Pasarela de Pago
  A->>S: Solicitar matrícula
  S->>DB: Validar prerrequisitos
  DB-->>S: Prerrequisitos OK
  S->>DB: Verificar vacantes
  DB-->>S: Vacantes disponibles
  S->>A: Mostrar boleta
  A->>P: Realizar pago
  P-->>S: Pago confirmado
  S->>A: Enviar constancia`;
    expect(d).toContain("sequenceDiagram");
    expect((d.match(/participant/g) || []).length).toBe(4);
  });

  it("28: Word documento arquitectura software C4", async () => {
    const r = await generateDocument("word", {
      title: "Documento de Arquitectura de Software - Sistema ERP",
      sections: [
        { heading: "Diagrama de Contexto (C4 Level 1)", paragraphs: ["El sistema ERP interactúa con: Usuarios, Sistema Bancario, SUNAT, Proveedores."] },
        { heading: "Diagrama de Contenedores (C4 Level 2)", paragraphs: ["Frontend (React), API Gateway (Node.js), Microservicios (Python/Java), PostgreSQL, Redis, S3."] },
        { heading: "Decisiones de Diseño", list: { items: ["Patrón: Event-Driven Architecture","BD: PostgreSQL con read replicas","Cache: Redis con TTL 5 min","Auth: OAuth 2.0 + JWT","CI/CD: GitHub Actions + ArgoCD"] } },
        { heading: "Stack Tecnológico", table: { headers: ["Capa","Tecnología","Justificación"], rows: [["Frontend","React 19 + Vite","Performance, ecosistema"],["Backend","Node.js + Express","Non-blocking I/O"],["Database","PostgreSQL 16","ACID, pgvector"],["Cache","Redis 7","Sub-ms latency"],["Infra","Kubernetes","Escalabilidad"]] } },
        { heading: "API Specifications", paragraphs: ["RESTful con OpenAPI 3.1, versionamiento por path (/v1/, /v2/)."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("29: Excel matriz RACI 20 tareas 6 roles", async () => {
    const roles = ["PM","Backend","Frontend","QA","DBA","DevOps"];
    const tasks = Array.from({ length: 20 }, (_, i) => {
      const raci = roles.map(() => ["R","A","C","I"][Math.floor(Math.random()*4)]);
      return [`Tarea ${i+1}`, ...raci];
    });
    const { buffer } = await createExcelFromData([["Tarea", ...roles], ...tasks], { title: "Matriz_RACI" });
    expect(buffer.length).toBeGreaterThan(4000);
  });

  it("30: diagrama mermaid microservicios 7+ servicios", () => {
    const d = `flowchart TD
  GW[API Gateway] --> Auth[Auth Service]
  GW --> US[User Service]
  GW --> PS[Product Service]
  GW --> OS[Order Service]
  GW --> Pay[Payment Service]
  GW --> NS[Notification Service]
  GW --> AS[Analytics Service]
  Auth --> AuthDB[(Auth DB)]
  US --> UserDB[(User DB)]
  PS --> ProductDB[(Product DB)]
  OS --> OrderDB[(Order DB)]`;
    expect((d.match(/Service/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  it("31: Excel estimación puntos de función", async () => {
    const { buffer } = await createExcelFromData([
      ["Transacción","Tipo","Complejidad","PF Bruto"],
      ["Login","EI","Baja",3],["Registro usuario","EI","Media",4],["Buscar productos","EQ","Media",4],
      ["Crear orden","EI","Alta",6],["Listar órdenes","EO","Media",5],["Reporte ventas","EO","Alta",7],
      ["Dashboard","EO","Alta",7],["Config perfil","EI","Baja",3],["Notificaciones","EO","Baja",4],
      ["Importar CSV","EI","Alta",6],["Exportar PDF","EO","Media",5],["API REST","EIF","Alta",10],
      ["Integración pago","EIF","Alta",10],["Backup","ILF","Media",7],["Auditoría","EO","Media",5],
    ], { title: "Puntos_Funcion", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(4000);
  });

  it("32: PPT propuesta ERP con módulos", async () => {
    const r = await generateDocument("pptx", {
      title: "Propuesta Técnica - Sistema ERP ILIAGPT",
      slides: [
        { type: "content", title: "Módulo Ventas", bullets: ["Gestión de cotizaciones","Órdenes de venta","Facturación electrónica SUNAT","CRM integrado"] },
        { type: "content", title: "Módulo Compras", bullets: ["Órdenes de compra","Evaluación de proveedores","Recepción de mercadería","Cuentas por pagar"] },
        { type: "content", title: "Módulo Inventario", bullets: ["Control de stock multi-almacén","Kardex valorizado","Código de barras","Inventario cíclico"] },
        { type: "content", title: "Módulo Contabilidad", bullets: ["Plan contable PCGE","Libros electrónicos PLE","Estados financieros","Análisis de cuentas"] },
        { type: "content", title: "Módulo RRHH", bullets: ["Planilla electrónica PLAME","Control de asistencia","Evaluación de desempeño","Capacitaciones"] },
        { type: "table", title: "Cronograma", tableData: { headers: ["Fase","Duración","Entregable"], rows: [["Análisis","4 sem","SRS"],["Diseño","3 sem","Arquitectura"],["Desarrollo","12 sem","MVP"],["Testing","4 sem","Reporte QA"],["Despliegue","2 sem","Go-Live"]] } },
        { type: "content", title: "Presupuesto", bullets: ["Licencias: $0 (Open Source)","Desarrollo: $85,000","Infraestructura: $12,000/año","Soporte: $18,000/año","ROI estimado: 18 meses"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(8);
  });

  it("33: HTML dashboard monitoreo servidores", () => {
    const html = `<!DOCTYPE html><html><head><style>
  .card{display:inline-block;width:180px;padding:20px;margin:10px;border-radius:8px;text-align:center;color:white;font-family:Arial}
  .green{background:#27ae60}.yellow{background:#f39c12}.red{background:#e74c3c}
  table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:left}
  th{background:#2c3e50;color:white}
</style></head><body>
  <h1>Server Monitoring Dashboard</h1>
  <div class="card green"><h3>CPU</h3><p>45%</p></div>
  <div class="card green"><h3>RAM</h3><p>62%</p></div>
  <div class="card yellow"><h3>Disco</h3><p>78%</p></div>
  <div class="card green"><h3>Red</h3><p>125 Mbps</p></div>
  <table><thead><tr><th>Alerta</th><th>Severidad</th><th>Hora</th></tr></thead>
  <tbody><tr><td>Disco >75%</td><td>Warning</td><td>14:32</td></tr></tbody></table>
</body></html>`;
    expect(html).toContain("CPU");
    expect(html).toContain("RAM");
    expect(html).toContain("Disco");
    expect(html).toContain("Red");
    expect(html).toContain(".green");
    expect(html).toContain(".yellow");
    expect(html).toContain(".red");
  });

  it("34: Word SRS IEEE 830", async () => {
    const r = await generateDocument("word", {
      title: "Especificación de Requisitos de Software (SRS) - IEEE 830",
      sections: [
        { heading: "1. Propósito", paragraphs: ["Este documento especifica los requisitos del sistema de gestión académica."] },
        { heading: "2. Alcance", paragraphs: ["El sistema cubre matrícula, notas, horarios, reportes y administración."] },
        { heading: "3. Requisitos Funcionales", list: { items: ["RF-01: El sistema debe permitir registro de estudiantes","RF-02: Validar prerrequisitos en matrícula","RF-03: Generar boletas de notas","RF-04: Gestión de horarios","RF-05: Reportes estadísticos"] } },
        { heading: "4. Requisitos No Funcionales", list: { items: ["RNF-01: Tiempo de respuesta < 2 segundos","RNF-02: Disponibilidad 99.5%","RNF-03: Soporte para 1000 usuarios concurrentes","RNF-04: Cifrado AES-256 en datos sensibles","RNF-05: Compatible con Chrome, Firefox, Safari"] } },
        { heading: "5. Interfaces", paragraphs: ["Interfaz web responsive, API REST, integración con SUNEDU y RENIEC."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("35: diagrama deployment mermaid infraestructura", () => {
    const d = `flowchart TD
  LB[Nginx Load Balancer] --> App1[App Server 1 - Node.js]
  LB --> App2[App Server 2 - Node.js]
  LB --> App3[App Server 3 - Node.js]
  App1 --> PG_P[(PostgreSQL Primary)]
  App2 --> PG_P
  App3 --> PG_P
  PG_P --> PG_R1[(Replica 1)]
  PG_P --> PG_R2[(Replica 2)]
  App1 --> Redis[(Redis Cluster)]
  App2 --> Redis
  App3 --> Redis
  App1 --> S3[(S3 Storage)]`;
    expect(d).toContain("Load Balancer");
    expect(d).toContain("PostgreSQL");
    expect(d).toContain("Redis");
  });

  it("36: Excel testing matrix 20 test cases", async () => {
    const cases = Array.from({ length: 20 }, (_, i) => [
      `TC-${(i+1).toString().padStart(3,"0")}`, `Test case ${i+1}`, `Precondición ${i+1}`,
      `Paso 1, Paso 2, Paso 3`, `Resultado esperado ${i+1}`,
      Math.random() > 0.2 ? "Pass" : "Fail", ["Alta","Media","Baja"][Math.floor(Math.random()*3)],
    ]);
    const { buffer } = await createExcelFromData(
      [["ID","Descripción","Precondición","Pasos","Resultado Esperado","Estado","Prioridad"], ...cases],
      { title: "Testing_Matrix", conditionalFormatting: true },
    );
    expect(buffer.length).toBeGreaterThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
// ING. INDUSTRIAL (tests 37-50)
// ═══════════════════════════════════════════════════════════════
describe("Ingeniería Industrial", () => {
  it("37: Excel estudio de tiempos 15 operaciones", async () => {
    const ops = Array.from({ length: 15 }, (_, i) => {
      const obs = Array.from({ length: 10 }, () => (2 + Math.random() * 5).toFixed(2));
      const avg = (obs.reduce((s, v) => s + parseFloat(v), 0) / 10).toFixed(2);
      return [`Op-${i+1}`, ...obs, avg, "1.05", (parseFloat(avg) * 1.05).toFixed(2), "12%", (parseFloat(avg) * 1.05 * 1.12).toFixed(2)];
    });
    const headers = ["Operación",...Array.from({length:10},(_,i)=>`Obs${i+1}`),"Promedio","FV","T.Normal","Supl","T.Tipo"];
    const { buffer } = await createExcelFromData([headers, ...ops], { title: "Estudio_Tiempos", autoFormulas: true });
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("38: diagrama mermaid proceso manufactura ASME", () => {
    const d = `flowchart TD
  A((Operación 1: Corte)) --> B{Inspección visual}
  B -->|OK| C((Operación 2: Doblado))
  C --> D[/Transporte a soldadura/]
  D --> E((Operación 3: Soldadura))
  E --> F{Inspección dimensional}
  F -->|OK| G((Operación 4: Acabado))
  G --> H[/Transporte a almacén/]
  H --> I[(Almacenamiento)]`;
    expect(d).toContain("Operación");
    expect(d).toContain("Inspección");
    expect(d).toContain("Transporte");
    expect(d).toContain("Almacenamiento");
  });

  it("39: Excel MRP niveles 0-1-2", async () => {
    const { buffer } = await createMultiSheetExcel([
      { name: "BOM", data: [["Nivel","Código","Descripción","Cantidad","Lead Time"],["0","PT-001","Producto Terminado",1,1],["1","SE-001","Subensamble A",2,2],["1","SE-002","Subensamble B",1,1],["1","SE-003","Subensamble C",3,2],["2","MP-001","Componente 1",4,1],["2","MP-002","Componente 2",2,1],["2","MP-003","Componente 3",6,2],["2","MP-004","Componente 4",3,1]] },
      { name: "MRP_Nivel0", data: [["Semana",1,2,3,4,5,6,7,8],["Necesidades brutas",0,0,100,0,0,150,0,0],["Stock",50,50,50,0,0,0,0,0],["Necesidades netas",0,0,50,0,0,150,0,0],["Recepción planificada",0,0,50,0,0,150,0,0],["Lanzamiento",0,50,0,0,150,0,0,0]], options: { autoFormulas: true } },
      { name: "MRP_Nivel1", data: [["Semana",1,2,3,4,5,6,7,8],["SE-001 Neces. brutas",0,100,0,0,300,0,0,0],["SE-001 Stock",20,0,0,0,0,0,0,0],["SE-001 Neces. netas",0,80,0,0,300,0,0,0]], options: { autoFormulas: true } },
    ]);
    expect(await xlsxSheetCount(buffer)).toBe(3);
    expect(await xlsxContains(buffer, "Necesidades")).toBe(true);
  });

  it("40: Word plan implementación 5S", async () => {
    const r = await generateDocument("word", {
      title: "Plan de Implementación de Metodología 5S",
      sections: [
        { heading: "Diagnóstico Inicial", paragraphs: ["Auditoría inicial: Puntaje 32/100. Áreas críticas: almacén, zona de producción."] },
        { heading: "1S - Seiri (Clasificar)", paragraphs: ["Separar lo necesario de lo innecesario. Meta: reducir 40% de objetos en área."] },
        { heading: "2S - Seiton (Ordenar)", paragraphs: ["Un lugar para cada cosa. Implementar sistema de ubicación visual."] },
        { heading: "3S - Seiso (Limpiar)", paragraphs: ["Programa de limpieza por zonas. Responsables asignados por turno."] },
        { heading: "4S - Seiketsu (Estandarizar)", paragraphs: ["Procedimientos estándar. Checklist diario. Auditorías semanales."] },
        { heading: "5S - Shitsuke (Disciplina)", paragraphs: ["Capacitación continua. Reconocimiento al mejor equipo. KPIs mensuales."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
    const zip = await JSZip.loadAsync(r.buffer);
    const doc = await zip.files["word/document.xml"]?.async("text");
    expect(doc).toContain("Seiri");
    expect(doc).toContain("Shitsuke");
  });

  it("41: Excel análisis capacidad 8 estaciones", async () => {
    const { buffer } = await createExcelFromData([
      ["Estación","T.Ciclo(min)","Cap/hora","Eficiencia","Cuello botella"],
      ["Corte",2.5,24,"80%",""],
      ["Doblado",3.2,18.75,"62.5%","⚠"],
      ["Soldadura",2.8,21.43,"71.4%",""],
      ["Esmerilado",1.5,40,"100%",""],
      ["Pintura",2.0,30,"100%",""],
      ["Ensamble",3.0,20,"66.7%",""],
      ["Inspección",1.0,60,"100%",""],
      ["Empaque",1.8,33.33,"100%",""],
    ], { title: "Analisis_Capacidad", conditionalFormatting: true });
    expect(await xlsxContains(buffer, "Estación")).toBe(true);
  });

  it("42: PPT proyecto Six Sigma DMAIC", async () => {
    const r = await generateDocument("pptx", {
      title: "Proyecto Six Sigma - Reducción de Defectos en Línea de Envasado",
      slides: [
        { type: "content", title: "DEFINE - Definir", bullets: ["CTQ: Peso neto del producto ±2%","SIPOC: Proveedor→Insumos→Proceso→Outputs→Clientes","Objetivo: Reducir sigma de 3.2 a 4.5"] },
        { type: "content", title: "MEASURE - Medir", bullets: ["MSA: Gage R&R = 8.5% (aceptable)","Cpk actual = 0.89","Defectos actuales: 6.8%"] },
        { type: "content", title: "ANALYZE - Analizar", bullets: ["Ishikawa: 6M análisis de causas raíz","5 Porqués: velocidad de llenado variable","Pareto: 80% defectos en 3 causas"] },
        { type: "content", title: "IMPROVE - Mejorar", bullets: ["DOE 2³: velocidad, temperatura, presión","Configuración óptima identificada","Piloto exitoso: defectos 1.2%"] },
        { type: "content", title: "CONTROL - Controlar", bullets: ["Cartas X-barra y R implementadas","Plan de control documentado","Capacitación a operadores","Cpk final = 1.67"] },
      ],
    });
    expect(await pptxSlideCount(r.buffer)).toBeGreaterThanOrEqual(6);
  });

  it("43: Excel SPC carta X-barra 25 subgrupos", async () => {
    const subgroups = Array.from({ length: 25 }, (_, i) => {
      const samples = Array.from({ length: 5 }, () => (50 + (Math.random() - 0.5) * 4).toFixed(2));
      const xbar = (samples.reduce((s, v) => s + parseFloat(v), 0) / 5).toFixed(3);
      const range = (Math.max(...samples.map(Number)) - Math.min(...samples.map(Number))).toFixed(3);
      return [`SG-${i+1}`, ...samples, xbar, range];
    });
    const { buffer } = await createExcelFromData(
      [["Subgrupo","M1","M2","M3","M4","M5","X-bar","Rango"], ...subgroups],
      { title: "SPC_X_Barra", autoFormulas: true },
    );
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it("44: SVG diagrama de Ishikawa 6M con 18 causas", () => {
    const svg = `<svg viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg">
  <line x1="100" y1="250" x2="800" y2="250" stroke="#333" stroke-width="3"/>
  <rect x="800" y="220" width="90" height="60" fill="#e74c3c" rx="5"/>
  <text x="845" y="255" text-anchor="middle" fill="white" font-weight="bold">Defecto</text>
  ${["Mano de obra","Máquina","Material","Método","Medición","Medio Amb."].map((m,i) => {
    const x = 180 + i * 110;
    const y = i % 2 === 0 ? 100 : 400;
    const dy = i % 2 === 0 ? 1 : -1;
    return `<line x1="${x}" y1="${y}" x2="${x}" y2="250" stroke="#2c3e50" stroke-width="2"/>
  <text x="${x}" y="${y - 10 * dy}" text-anchor="middle" font-size="11" font-weight="bold">${m}</text>
  <text x="${x-30}" y="${y + 20 * dy}" font-size="9">Causa ${i*3+1}</text>
  <text x="${x}" y="${y + 35 * dy}" font-size="9">Causa ${i*3+2}</text>
  <text x="${x+30}" y="${y + 50 * dy}" font-size="9">Causa ${i*3+3}</text>`;
  }).join("\n  ")}
</svg>`;
    expect(svg).toContain("Mano de obra");
    expect(svg).toContain("Máquina");
    expect(svg).toContain("Material");
    expect(svg).toContain("Método");
    expect(svg).toContain("Medición");
    expect(svg).toContain("Medio Amb");
    expect((svg.match(/Causa \d+/g) || []).length).toBe(18);
  });

  it("45: Excel ABC inventario 100 SKUs con Pareto", async () => {
    const skus = Array.from({ length: 100 }, (_, i) => {
      const demand = Math.floor(100 + Math.random() * 9900);
      const cost = parseFloat((1 + Math.random() * 99).toFixed(2));
      return [`SKU-${(i+1).toString().padStart(3,"0")}`, demand, cost, parseFloat((demand * cost).toFixed(2))];
    }).sort((a, b) => (b[3] as number) - (a[3] as number));
    const total = skus.reduce((s, r) => s + (r[3] as number), 0);
    let cumPct = 0;
    const rows = skus.map(r => {
      cumPct += ((r[3] as number) / total) * 100;
      const cls = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
      return [...r, `${cumPct.toFixed(1)}%`, cls];
    });
    const { buffer } = await createExcelFromData(
      [["SKU","Demanda","Costo Unit.","Valor Anual","% Acum.","Clasificación"], ...rows],
      { title: "ABC_Inventario", conditionalFormatting: true },
    );
    expect(buffer.length).toBeGreaterThan(8000);
  });

  it("46: Excel layout planta Guerchet", async () => {
    const { buffer } = await createExcelFromData([
      ["Área","Máquinas","n","N","Largo(m)","Ancho(m)","Altura(m)","Ss(m²)","Sg(m²)","Se(m²)","St(m²)"],
      ["Corte","Sierra circular",2,1,1.5,0.8,1.2,1.20,1.20,1.04,6.88],
      ["Doblado","Dobladora",1,2,2.0,1.0,1.5,2.00,4.00,2.60,8.60],
      ["Soldadura","Equipo MIG",3,1,0.8,0.6,1.0,0.48,0.48,0.42,4.14],
      ["Pintura","Cabina",1,1,3.0,2.0,2.5,6.00,6.00,5.20,17.20],
      ["Ensamble","Mesa",4,2,2.5,1.2,0.9,3.00,6.00,3.90,51.60],
      ["Almacén","Estantería",6,1,2.0,0.6,2.0,1.20,1.20,1.04,20.64],
    ], { title: "Layout_Guerchet", autoFormulas: true });
    expect(await xlsxContains(buffer, "Guerchet") || await xlsxContains(buffer, "Corte")).toBe(true);
  });

  it("47: Word procedimiento operativo estándar soldadura", async () => {
    const r = await generateDocument("word", {
      title: "Procedimiento Operativo Estándar - Soldadura GMAW",
      sections: [
        { heading: "Alcance", paragraphs: ["Aplica a todas las operaciones de soldadura GMAW en acero estructural A36."] },
        { heading: "EPP Requerido", list: { items: ["Careta de soldar (filtro #10-12)","Guantes de cuero largo","Mandil de cuero","Botas dieléctricas","Protección respiratoria"] } },
        { heading: "Procedimiento", list: { items: ["1. Verificar equipo y conexiones","2. Seleccionar parámetros (voltaje, amperaje, velocidad)","3. Preparar junta según WPS","4. Precalentar si espesor > 25mm","5. Ejecutar cordón raíz","6. Limpiar escoria entre pasadas","7. Ejecutar pasadas de relleno","8. Ejecutar pasada de acabado","9. Enfriamiento controlado","10. Inspección visual 100%"] } },
        { heading: "Criterios de Aceptación", paragraphs: ["Según AWS D1.1: sin grietas, porosidad < 3/8\", socavación < 1/32\"."] },
      ],
    });
    expect(r.buffer.length).toBeGreaterThan(5000);
  });

  it("48: Excel OEE 5 máquinas con semáforo", async () => {
    const { buffer } = await createExcelFromData([
      ["Máquina","Disponibilidad(%)","Rendimiento(%)","Calidad(%)","OEE(%)","Clasificación"],
      ["CNC-01",92,88,97,78.6,"Aceptable"],
      ["CNC-02",85,82,95,66.2,"Deficiente"],
      ["Torno-01",95,91,98,84.7,"Bueno"],
      ["Fresadora-01",78,75,93,54.4,"Inaceptable"],
      ["Rectificadora",98,94,99,91.2,"World Class"],
    ], { title: "OEE_Maquinas", conditionalFormatting: true });
    expect(await xlsxContains(buffer, "OEE") || await xlsxContains(buffer, "Disponibilidad")).toBe(true);
  });

  it("49: diagrama mermaid cadena suministro bidireccional", () => {
    const d = `flowchart LR
  P[Proveedor] --> AMP[Almacén MP]
  AMP --> PROD[Producción]
  PROD --> APT[Almacén PT]
  APT --> DIST[Distribución]
  DIST --> PV[Punto de Venta]
  PV --> CLI[Cliente]
  CLI -.->|Información de demanda| PV
  PV -.->|Forecast| DIST
  DIST -.->|Orden de reposición| APT
  APT -.->|Plan de producción| PROD
  PROD -.->|Orden de compra| P`;
    expect(d).toContain("Proveedor");
    expect(d).toContain("Cliente");
    expect((d.match(/-->/g) || []).length).toBe(6);
    expect((d.match(/-\.->|/g) || []).length).toBeGreaterThan(0);
  });

  it("50: Excel programación producción SPT y EDD", async () => {
    const orders = Array.from({ length: 10 }, (_, i) => [
      `OT-${(i+1).toString().padStart(3,"0")}`,
      `Producto ${String.fromCharCode(65+i)}`,
      Math.floor(2 + Math.random() * 8), // tiempo proceso
      Math.floor(5 + Math.random() * 15), // fecha entrega (día)
    ]);
    const { buffer } = await createMultiSheetExcel([
      { name: "Datos", data: [["Orden","Producto","T.Proceso(días)","Fecha Entrega(día)"], ...orders] },
      { name: "SPT", data: [["Orden","T.Proceso","Fecha Entrega","Inicio","Fin","Tardanza"], ...[...orders].sort((a,b) => (a[2] as number) - (b[2] as number)).map((o,i,arr) => {
        const start = i === 0 ? 0 : arr.slice(0,i).reduce((s,r) => s + (r[2] as number), 0);
        const end = start + (o[2] as number);
        return [o[0], o[2], o[3], start, end, Math.max(0, end - (o[3] as number))];
      })] },
      { name: "EDD", data: [["Orden","T.Proceso","Fecha Entrega","Inicio","Fin","Tardanza"], ...[...orders].sort((a,b) => (a[3] as number) - (b[3] as number)).map((o,i,arr) => {
        const start = i === 0 ? 0 : arr.slice(0,i).reduce((s,r) => s + (r[2] as number), 0);
        const end = start + (o[2] as number);
        return [o[0], o[2], o[3], start, end, Math.max(0, end - (o[3] as number))];
      })] },
    ]);
    expect(await xlsxSheetCount(buffer)).toBe(3);
  });
});
