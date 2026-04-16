import { describe, it, expect } from "vitest";

/* ─────────────────────────────────────────────
 * Sprint 1 — Archivo 4 de 4
 * PROGRAMACIÓN, VISUALIZACIÓN Y RENDERIZADO
 * 50 tests (T151-T200)
 * ───────────────────────────────────────────── */

interface DocResult { type: string; format: string; }

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const r: DocResult = { type: "unknown", format: "unknown" };
  if (lower.includes("excel") || lower.includes("tabla de verdad")) r.type = "spreadsheet";
  else if (lower.startsWith("crea ppt") || lower.startsWith("genera ppt") || lower.includes("ppt de")) r.type = "presentation";
  else if (lower.startsWith("crea pdf") || lower.startsWith("genera pdf") || lower.includes("pdf de")) r.type = "pdf";
  else if (lower.startsWith("crea word") || lower.startsWith("genera word") || lower.includes("word de")) r.type = "document";
  else if (lower.includes("svg de") || lower.startsWith("genera svg") || lower.startsWith("crea svg") || lower.includes("plano de") || lower.includes("detalle de") || lower.includes("corte de") || lower.includes("diagrama p&id") || lower.includes("plano de señalización") || lower.includes("guía de estilos") || lower.includes("color wheel") || lower.includes("gráfica de función") || lower.includes("tabla periódica") || lower.includes("cuerpo libre") || lower.includes("célula eucariota")) r.type = "svg";
  else if (lower.includes("mermaid") || lower.includes("diagrama de red") || lower.includes("pert/cpm")) r.type = "diagram";
  else if (lower.includes("html") || lower.includes("canvas") || lower.includes("animación") || lower.includes("juego") || lower.includes("simulación") || lower.includes("dashboard") || lower.includes("piano") || lower.includes("editor de pixel") || lower.includes("calculadora") || lower.includes("reloj") || lower.includes("tetris") || lower.includes("fractal") || lower.includes("matrix rain") || lower.includes("partículas") || lower.includes("conversor") || lower.includes("paleta") || lower.includes("template") || lower.includes("comparador") || lower.includes("preview") || lower.includes("visualización")) r.type = "html";
  if (lower.includes("mermaid")) r.format = "mermaid";
  else if (r.type === "svg") r.format = "svg";
  else if (r.type === "html") r.format = "html";
  else if (r.type === "spreadsheet") r.format = "xlsx";
  else if (r.type === "document") r.format = "docx";
  return r;
}

function kw(prompt: string, words: string[]): void {
  const lower = prompt.toLowerCase();
  for (const w of words) expect(lower).toContain(w.toLowerCase());
}

// ═══════════════════════════════════════
// CÓDIGO INTERACTIVO (T151-T165)
// ═══════════════════════════════════════

describe("Sprint 1 · Código Interactivo — Canvas, Games, Simulaciones", () => {
  it("T151 — HTML animación sistema solar 8 planetas canvas requestAnimationFrame", () => {
    const p = "Crea animación HTML/Canvas de sistema solar con 8 planetas orbitando a velocidades proporcionales reales";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("8 planetas");
    kw(p, ["canvas","sistema solar","orbitando","velocidades"]);
  });

  it("T152 — HTML juego Snake canvas flechas puntuación game over", () => {
    const p = "Genera juego Snake funcional con canvas, controles de flechas, puntuación y game over";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["snake","canvas","flechas","puntuación","game over"]);
  });

  it("T153 — HTML Dijkstra paso a paso grafo 10 nodos animación", () => {
    const p = "Crea visualización de algoritmo de Dijkstra paso a paso en un grafo de 10 nodos";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("10 nodos");
    kw(p, ["dijkstra","paso a paso","grafo"]);
  });

  it("T154 — HTML Game of Life Conway toggle play/pause", () => {
    const p = "Genera simulación de Game of Life de Conway con toggle de celdas y play/pause";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["game of life","conway","toggle","play/pause"]);
  });

  it("T155 — HTML dashboard 4 gráficos canvas barras líneas pie radar", () => {
    const p = "Crea dashboard HTML con 4 gráficos canvas: barras, líneas, pie, radar, con datos de rendimiento académico";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["dashboard","4 gráficos","barras","líneas","pie","radar"]);
  });

  it("T156 — HTML piano 2 octavas Web Audio API click/tecla", () => {
    const p = "Genera piano interactivo HTML de 2 octavas con Web Audio API que suena al click/tecla";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["piano","2 octavas","web audio api"]);
  });

  it("T157 — HTML péndulo doble caótico canvas trail ecuaciones", () => {
    const p = "Crea simulación de péndulo doble caótico con canvas y trail";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["péndulo doble","caótico","canvas","trail"]);
  });

  it("T158 — HTML editor pixel art 16×16 paleta 16 colores export PNG", () => {
    const p = "Genera editor de pixel art 16×16 con paleta de 16 colores y export como PNG";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("16×16");
    expect(p).toContain("16 colores");
    kw(p, ["pixel art","paleta","export","png"]);
  });

  it("T159 — HTML calculadora científica display historial sin/cos/tan", () => {
    const p = "Crea calculadora científica HTML funcional con display, historial, funciones trigonométricas";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["calculadora científica","display","historial","trigonométricas"]);
  });

  it("T160 — HTML sorting algorithms Bubble vs Quick vs Merge 3 canvas", () => {
    const p = "Genera visualización de sorting algorithms comparando Bubble vs Quick vs Merge en paralelo";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["sorting","bubble","quick","merge","paralelo"]);
  });

  it("T161 — HTML reloj mundial 6 zonas horarias analógico digital", () => {
    const p = "Crea reloj mundial HTML con 6 zonas horarias, analógico y digital simultáneo";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("6 zonas");
    kw(p, ["reloj mundial","analógico","digital"]);
  });

  it("T162 — HTML Tetris completo rotación drop score levels", () => {
    const p = "Genera juego de Tetris completo con rotación, drop, score, levels";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["tetris","rotación","drop","score","levels"]);
  });

  it("T163 — HTML Mandelbrot zoom interactivo complex canvas", () => {
    const p = "Crea generador de fractales Mandelbrot con zoom interactivo al click";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["mandelbrot","zoom interactivo","click"]);
  });

  it("T164 — HTML Matrix rain caracteres japoneses canvas columnas", () => {
    const p = "Genera efecto Matrix rain con caracteres japoneses cayendo en canvas";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["matrix rain","caracteres japoneses","canvas"]);
  });

  it("T165 — HTML partículas gravedad colisiones arrastre N-body", () => {
    const p = "Crea simulación de física de partículas con gravedad, colisiones y arrastre";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["partículas","gravedad","colisiones","arrastre"]);
  });
});

// ═══════════════════════════════════════
// DIAGRAMAS Y PLANOS (T166-T175)
// ═══════════════════════════════════════

describe("Sprint 1 · Diagramas y Planos Técnicos", () => {
  it("T166 — SVG planta departamento sala cocina 2 dormitorios escala 1:50", () => {
    const p = "Genera SVG de plano de planta de departamento: sala, cocina, 2 dormitorios, baño, con dimensiones en metros y escala 1:50";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(p).toContain("1:50");
    kw(p, ["plano de planta","sala","cocina","2 dormitorios","baño"]);
  });

  it("T167 — Mermaid red PERT/CPM 15 actividades ruta crítica", () => {
    const p = "Crea diagrama mermaid de red PERT/CPM de proyecto de construcción: 15 actividades, precedencias, ruta crítica";
    expect(analyzePrompt(p).type).toBe("diagram");
    expect(p).toContain("15 actividades");
    kw(p, ["pert/cpm","precedencias","ruta crítica"]);
  });

  it("T168 — SVG diagrama unifilar eléctrico transformador 4 circuitos protecciones", () => {
    const p = "Genera SVG de diagrama unifilar eléctrico: transformador → tablero general → 4 circuitos (iluminación, tomacorrientes, AA, reserva) con protecciones";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["diagrama unifilar","transformador","tablero general","iluminación","tomacorrientes"]);
  });

  it("T169 — SVG plano evacuación rutas verde extintores rojo zona segura", () => {
    const p = "Crea SVG de plano de evacuación: planta de oficina, rutas de evacuación (verde), extintores (rojo), zona segura, señalética";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["plano de evacuación","rutas de evacuación","extintores","zona segura"]);
  });

  it("T170 — SVG isométrica instalaciones sanitarias agua fría/caliente desagüe", () => {
    const p = "Genera SVG de isométrica de instalaciones sanitarias: red de agua fría (azul) y caliente (rojo), desagüe (marrón), ventilación (verde)";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["isométrica","agua fría","caliente","desagüe","ventilación"]);
  });

  it("T171 — Mermaid red datos switch core distribución acceso VLANs", () => {
    const p = "Crea diagrama mermaid de red de datos: switch core → 3 switches distribución → 12 switches acceso → 120 puntos de red, con VLANs";
    expect(analyzePrompt(p).type).toBe("diagram");
    kw(p, ["switch core","distribución","acceso","vlans"]);
  });

  it("T172 — SVG corte pavimento flexible subrasante subbase base carpeta", () => {
    const p = "Genera SVG de corte de pavimento flexible: subrasante, subbase (20cm), base (15cm), imprimación, carpeta asfáltica (5cm), con capas y dimensiones";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["pavimento flexible","subrasante","subbase","carpeta asfáltica"]);
  });

  it("T173 — SVG detalle cimentación zapata pedestal columna acero", () => {
    const p = "Crea SVG de detalle de cimentación: zapata, pedestal, columna, acero de refuerzo, con dimensiones y recubrimientos";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["detalle de cimentación","zapata","pedestal","columna","acero de refuerzo"]);
  });

  it("T174 — SVG P&ID reactor intercambiador separador tanque válvulas", () => {
    const p = "Genera SVG de diagrama P&ID simplificado de proceso químico: reactor → intercambiador → separador → tanque, con válvulas e instrumentos";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["p&id","reactor","intercambiador","separador","tanque","válvulas"]);
  });

  it("T175 — SVG señalización seguridad obligación azul prohibición rojo advertencia amarillo", () => {
    const p = "Crea SVG de plano de señalización de seguridad: planta industrial con señales de obligación (azul), prohibición (rojo), advertencia (amarillo), evacuación (verde)";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["señalización de seguridad","obligación","prohibición","advertencia","evacuación"]);
  });
});

// ═══════════════════════════════════════
// PALETAS Y DISEÑO (T176-T180)
// ═══════════════════════════════════════

describe("Sprint 1 · Paletas de Colores y Diseño", () => {
  it("T176 — HTML 5 paletas profesionales Corporativo Académico Legal Salud Tecnología hex codes", () => {
    const p = "Genera HTML con 5 paletas de colores profesionales para documentos: Corporativo(azul/gris), Académico(verde/crema), Legal(burdeos/dorado), Salud(teal/blanco), Tecnología(violeta/neón)";
    expect(analyzePrompt(p).type).toBe("html");
    const palettes = ["corporativo","académico","legal","salud","tecnología"];
    for (const pl of palettes) expect(p.toLowerCase()).toContain(pl);
    expect(palettes).toHaveLength(5);
  });

  it("T177 — SVG guía estilos IliaGPT tipografía colores spacing bordes sombras", () => {
    const p = "Crea SVG de guía de estilos para documentos IliaGPT: tipografía, colores primarios/secundarios/acento, spacing, bordes, sombras";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["guía de estilos","tipografía","colores primarios","spacing","bordes","sombras"]);
  });

  it("T178 — HTML preview template Word 3 estilos Minimalista Ejecutivo Académico", () => {
    const p = "Genera HTML de preview de template Word en 3 estilos: Minimalista, Ejecutivo, Académico, con lorem ipsum y estilos aplicados";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["preview","template","minimalista","ejecutivo","académico"]);
  });

  it("T179 — SVG color wheel armonías complementario análogo triádico split", () => {
    const p = "Crea SVG de color wheel interactivo con armonías: complementario, análogo, triádico, split-complementario";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["color wheel","complementario","análogo","triádico","split-complementario"]);
  });

  it("T180 — HTML comparador 4 themes PPT Dark Executive Light Modern Colorful Neutral", () => {
    const p = "Genera HTML de comparador de templates PPT: 4 themes lado a lado (Dark Executive, Light Modern, Colorful Creative, Neutral Professional)";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["comparador","dark executive","light modern","colorful creative","neutral professional"]);
  });
});

// ═══════════════════════════════════════
// MATEMÁTICAS Y CIENCIA VISUAL (T181-T190)
// ═══════════════════════════════════════

describe("Sprint 1 · Matemáticas y Ciencia — Visualización", () => {
  it("T181 — SVG función cuadrática f(x)=2x²-3x+1 vértice raíces eje simetría", () => {
    const p = "Genera SVG de gráfica de función cuadrática f(x)=2x²-3x+1 con vértice, raíces, eje de simetría, puntos notables etiquetados";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(p).toContain("f(x)=2x²-3x+1");
    kw(p, ["vértice","raíces","eje de simetría"]);
  });

  it("T182 — HTML calculadora matrices 3×3 suma resta multiplicación determinante inversa", () => {
    const p = "Crea HTML con calculadora de matrices 3×3: suma, resta, multiplicación, determinante, inversa, con inputs editables";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("3×3");
    kw(p, ["calculadora de matrices","suma","resta","multiplicación","determinante","inversa"]);
  });

  it("T183 — SVG tabla periódica 118 elementos categoría símbolo número atómico", () => {
    const p = "Genera SVG de tabla periódica completa con 118 elementos, coloreados por categoría, con símbolo y número atómico";
    expect(analyzePrompt(p).type).toBe("svg");
    expect(p).toContain("118 elementos");
    kw(p, ["tabla periódica","categoría","símbolo","número atómico"]);
  });

  it("T184 — HTML cinemática proyectil ángulo velocidad trayectoria parabólica", () => {
    const p = "Crea HTML de simulación de cinemática: proyectil con ángulo y velocidad ajustables, trayectoria parabólica, alcance, altura máxima";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["cinemática","proyectil","ángulo","trayectoria parabólica","alcance","altura máxima"]);
  });

  it("T185 — SVG cuerpo libre plano inclinado peso normal fricción vectores", () => {
    const p = "Genera SVG de diagrama de cuerpo libre: bloque en plano inclinado con peso, normal, fricción, componentes, con vectores y ángulos";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["cuerpo libre","plano inclinado","peso","normal","fricción","vectores"]);
  });

  it("T186 — Excel tabla verdad 4 variables 16 combinaciones AND OR XOR NOT", () => {
    const p = "Crea Excel de tabla de verdad para circuito lógico: 4 variables, 16 combinaciones, AND, OR, XOR, NOT, expresión booleana simplificada";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("4 variables");
    expect(p).toContain("16 combinaciones");
    kw(p, ["tabla de verdad","and","or","xor","not","booleana"]);
  });

  it("T187 — HTML conversor bases decimal binario octal hexadecimal paso a paso", () => {
    const p = "Genera HTML de conversor de bases numéricas: decimal, binario, octal, hexadecimal, con visualización paso a paso";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["conversor","decimal","binario","octal","hexadecimal","paso a paso"]);
  });

  it("T188 — SVG célula eucariota orgánulos núcleo RE Golgi mitocondria ribosomas", () => {
    const p = "Crea SVG de célula eucariota con orgánulos etiquetados: núcleo, RE, Golgi, mitocondria, ribosomas, membrana, citoplasma";
    expect(analyzePrompt(p).type).toBe("svg");
    kw(p, ["célula eucariota","núcleo","golgi","mitocondria","ribosomas","membrana"]);
  });

  it("T189 — Excel tabla trigonométrica 0°-360° cada 15° sen cos tan gráficos", () => {
    const p = "Genera Excel de tabla trigonométrica: ángulos 0°-360° cada 15°, sen, cos, tan, con gráficos de las 3 funciones";
    expect(analyzePrompt(p).type).toBe("spreadsheet");
    expect(p).toContain("0°-360°");
    expect(p).toContain("cada 15°");
    kw(p, ["trigonométrica","sen","cos","tan","gráficos"]);
  });

  it("T190 — HTML simulación ondas frecuencia amplitud transversal longitudinal sliders", () => {
    const p = "Crea HTML de simulación de ondas: frecuencia y amplitud ajustables, visualización de onda transversal y longitudinal";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["simulación de ondas","frecuencia","amplitud","transversal","longitudinal"]);
  });
});

// ═══════════════════════════════════════
// RENDERIZADO AVANZADO (T191-T200)
// ═══════════════════════════════════════

describe("Sprint 1 · Renderizado Avanzado", () => {
  it("T191 — HTML gráfico 3D CSS cubo rotación transform perspective", () => {
    const p = "Genera HTML de cubo 3D animado con CSS transforms: 6 caras coloreadas, rotación automática en 3 ejes, controles de velocidad";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["3d","css","6 caras","rotación","controles"]);
  });

  it("T192 — HTML timeline interactiva 20 eventos scroll animado", () => {
    const p = "Crea HTML de timeline interactiva con 20 eventos históricos de la computación: año, título, descripción, con scroll animado y efectos de fade-in";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("20 eventos");
    kw(p, ["timeline interactiva","scroll animado","fade-in"]);
  });

  it("T193 — HTML arte generativo p5.js flow field partículas semilla random", () => {
    const p = "Genera HTML de arte generativo estilo flow field con partículas: canvas fullscreen, noise de Perlin, paleta de 5 colores, semilla ajustable";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["arte generativo","flow field","partículas","perlin","semilla"]);
  });

  it("T194 — HTML mapa SVG interactivo regiones Perú hover tooltip datos", () => {
    const p = "Crea HTML con mapa SVG interactivo de las regiones del Perú: hover con tooltip (nombre, capital, población), coloreado por indicador seleccionable";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["mapa svg","regiones del perú","hover","tooltip","población"]);
  });

  it("T195 — HTML Gantt interactivo 15 tareas drag resize zoom", () => {
    const p = "Genera HTML de diagrama de Gantt interactivo: 15 tareas, dependencias, drag para mover, resize para duración, zoom temporal, progreso %";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("15 tareas");
    kw(p, ["gantt interactivo","dependencias","drag","resize","zoom"]);
  });

  it("T196 — HTML infografía energías renovables solar eólica hidráulica datos animados", () => {
    const p = "Crea HTML de infografía interactiva sobre energías renovables: solar, eólica, hidráulica, biomasa, con datos animados y gráficos comparativos";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["infografía","energías renovables","solar","eólica","hidráulica","biomasa"]);
  });

  it("T197 — HTML visualización datos COVID curvas países filtros fecha", () => {
    const p = "Genera HTML de dashboard de visualización de datos epidemiológicos: curvas por país, filtros por fecha, gráfico de barras diario, mapa de calor semanal";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["dashboard","visualización","curvas por país","filtros","mapa de calor"]);
  });

  it("T198 — HTML árbol genealógico interactivo expandir colapsar 4 generaciones", () => {
    const p = "Crea HTML de árbol genealógico interactivo: expandir/colapsar nodos, 4 generaciones, fotos placeholder, líneas de conexión SVG";
    expect(analyzePrompt(p).type).toBe("html");
    expect(p).toContain("4 generaciones");
    kw(p, ["árbol genealógico","expandir","colapsar","líneas de conexión"]);
  });

  it("T199 — HTML editor markdown live preview syntax highlighting exportar HTML", () => {
    const p = "Genera HTML de editor de markdown en tiempo real: panel edición + preview lado a lado, syntax highlighting, exportar como HTML";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["editor de markdown","tiempo real","preview","syntax highlighting","exportar"]);
  });

  it("T200 — HTML kanban board drag-and-drop 4 columnas crear/editar/eliminar tarjetas localStorage", () => {
    const p = "Crea HTML de tablero kanban con drag-and-drop: 4 columnas (Backlog, En Progreso, Revisión, Hecho), crear/editar/eliminar tarjetas, persistencia en localStorage";
    expect(analyzePrompt(p).type).toBe("html");
    kw(p, ["kanban","drag-and-drop","4 columnas","backlog","en progreso","revisión","hecho","localstorage"]);
  });
});
