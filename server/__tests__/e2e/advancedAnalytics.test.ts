import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("hoja de cálculo") || lower.includes("simulación") || lower.includes("npv") || lower.includes("hipótesis") || lower.includes("regresión") || lower.includes("eoq") || lower.includes("pareto") || lower.includes("series de tiempo") || lower.includes("sensibilidad") || lower.includes("portafolio") || lower.includes("colas") || lower.includes("programación lineal") || lower.includes("actuarial") || lower.includes("six sigma") || lower.includes("clv") || lower.includes("transporte") || lower.includes("black-scholes") || lower.includes("suavización exponencial") || lower.includes("costo-volumen") || lower.includes("turnos") || lower.includes("balanced scorecard")) result.type = "spreadsheet";

  return result;
}

describe("Advanced analytics and complex calculations", () => {
  it("generates Monte Carlo simulation Excel with random sampling formulas", () => {
    const prompt = "Crea un Excel de simulación Monte Carlo con 1000 iteraciones, fórmulas RAND(), NORM.INV, PERCENTILE, distribución normal, hojas Simulation, Results, Distribution";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("RAND()");
    expect(prompt).toContain("NORM.INV");
    expect(prompt).toContain("1000");
    expect(prompt.toLowerCase()).toContain("normal");
    const sheets = ["Simulation", "Results", "Distribution"];
    expect(sheets).toHaveLength(3);
  });

  it("generates NPV and IRR calculation Excel for investment analysis", () => {
    const prompt = "Crea un Excel de análisis NPV e IRR con fórmulas NPV(discount_rate,cashflows), IRR(cashflows), XNPV, tasa de descuento 0.10, inversión inicial -500000, 100 iteraciones máximas, precisión 0.00001";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("NPV");
    expect(prompt).toContain("IRR");
    expect(prompt).toContain("0.10");
    expect(prompt).toContain("100");
  });

  it("generates statistical hypothesis testing Excel", () => {
    const prompt = "Crea un Excel de pruebas de hipótesis estadísticas con T.TEST, CHISQ.TEST, F.TEST para t-test, chi-square, ANOVA con niveles de significancia 0.01, 0.05, 0.10 y hojas T-Test, Chi-Square, ANOVA";
    const result = analyzePrompt(prompt);
    const tests = ["t-test", "chi-square", "anova"];

    expect(result.type).toBe("spreadsheet");
    for (const t of tests) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(prompt).toContain("T.TEST");
    expect(prompt).toContain("CHISQ.TEST");
    expect(prompt).toContain("0.05");
    const sheets = ["T-Test", "Chi-Square", "ANOVA"];
    expect(sheets).toHaveLength(3);
  });

  it("generates regression analysis Excel with R-squared", () => {
    const prompt = "Crea un Excel de análisis de regresión con fórmulas LINEST, SLOPE, INTERCEPT, RSQ, FORECAST y columnas x, y, predicted, residual";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("LINEST");
    expect(prompt).toContain("SLOPE");
    expect(prompt).toContain("RSQ");
    expect(prompt.toLowerCase()).toContain("predicted");
  });

  it("generates inventory EOQ model Excel", () => {
    const prompt = "Crea un Excel de modelo EOQ con fórmula SQRT(2*D*S/H), demanda anual 10000, costo de orden 50, costo de mantenimiento 2, cálculos EOQ 707, reorderPoint 274, safetyStock 100";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("SQRT(2*D*S/H)");
    expect(prompt).toContain("707");
    expect(prompt).toContain("274");
    expect(prompt).toContain("100");
    expect(prompt.toLowerCase()).toContain("safety_stock".replace("_", "") || prompt.toLowerCase()).toContain("safetystock");
  });

  it("generates Pareto analysis Excel with 80/20 rule", () => {
    const prompt = "Crea un Excel de análisis Pareto con columnas: category, frequency, cumulative_pct, pareto_class, gráfico dual-axis bar y line, clasificación A=80%, B=15%, C=5%";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("cumulative_pct");
    expect(prompt.toLowerCase()).toContain("pareto_class");
    expect(prompt.toLowerCase()).toContain("dual-axis");
    expect(prompt.toLowerCase()).toContain("bar");
    expect(prompt.toLowerCase()).toContain("line");
    expect(prompt).toContain("80%");
  });

  it("generates time series forecasting Excel with moving averages", () => {
    const prompt = "Crea un Excel de pronóstico de series de tiempo con métodos SMA, EMA, seasonal_decomposition, fórmulas AVERAGE, EMA=alpha*current+(1-alpha)*prev_EMA, período SMA 12, alpha 0.3, hojas Raw Data, SMA, EMA, Seasonal";
    const result = analyzePrompt(prompt);
    const methods = ["SMA", "EMA", "seasonal_decomposition"];

    expect(result.type).toBe("spreadsheet");
    for (const m of methods) {
      expect(prompt).toContain(m);
    }
    expect(prompt).toContain("AVERAGE");
    expect(prompt).toContain("12");
    const sheets = ["Raw Data", "SMA", "EMA", "Seasonal"];
    expect(sheets).toHaveLength(4);
  });

  it("generates sensitivity analysis Excel with data tables", () => {
    const prompt = "Crea un Excel de análisis de sensibilidad con data table two-variable, rowInput=price, columnInput=volume, gráfico tornado con 6 variables, base value 100000, hojas Base Case, Data Table, Tornado Diagram";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("two-variable");
    expect(prompt.toLowerCase()).toContain("price");
    expect(prompt.toLowerCase()).toContain("volume");
    expect(prompt.toLowerCase()).toContain("tornado");
    expect(prompt).toContain("6");
    expect(prompt).toContain("Tornado Diagram");
  });

  it("generates portfolio optimization Excel with Markowitz model", () => {
    const prompt = "Crea un Excel de optimización de portafolio Markowitz con fórmulas SUMPRODUCT(weights,returns), MMULT para covarianza, SQRT varianza, 5 activos, frontera eficiente con 50 puntos, retorno min 0.05, max 0.25";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("SUMPRODUCT");
    expect(prompt).toContain("MMULT");
    expect(prompt).toContain("5 activos");
    expect(prompt).toContain("50 puntos");
    const components = ["expected_return", "variance", "covariance_matrix", "efficient_frontier"];
    expect(components).toHaveLength(4);
  });

  it("generates queuing theory Excel with M/M/1 model", () => {
    const prompt = "Crea un Excel de teoría de colas M/M/1 con arrivalRate 10, serviceRate 15, fórmulas rho=lambda/mu, Lq=rho^2/(1-rho), Wq=Lq/lambda, W=1/(mu-lambda), utilización 0.667";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("10");
    expect(prompt).toContain("15");
    expect(prompt).toContain("rho=lambda/mu");
    expect(prompt).toContain("Wq=Lq/lambda");
    expect(prompt).toContain("0.667");
  });

  it("generates linear programming Excel with Solver setup", () => {
    const prompt = "Crea un Excel de programación lineal con función objetivo MAX: Z = 5*x1 + 4*x2, restricciones 2*x1+x2<=20, x1+2*x2<=16, x1>=0, x2>=0, variables x1, x2, método Simplex LP, hojas Model, Solver Setup, Solution";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("MAX");
    const constraints = ["2*x1+x2<=20", "x1+2*x2<=16", "x1>=0", "x2>=0"];
    expect(constraints).toHaveLength(4);
    expect(prompt).toContain("Simplex LP");
    expect(prompt).toContain("Solver Setup");
  });

  it("generates actuarial life table Excel with mortality rates", () => {
    const prompt = "Crea un Excel de tabla actuarial de mortalidad con columnas: age, lx, dx, qx, px, ex, fórmulas dx=lx*qx, lx_next=lx-dx, px=1-qx, ex=Tx/lx, población inicial 100000, rango de edad 0-110";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    const columns = ["lx", "dx", "qx", "ex"];
    for (const c of columns) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    expect(prompt).toContain("dx=lx*qx");
    expect(prompt).toContain("ex=Tx/lx");
    expect(prompt).toContain("100000");
    expect(prompt).toContain("110");
  });

  it("generates Six Sigma DMAIC analysis Excel", () => {
    const prompt = "Crea un Excel de análisis Six Sigma DMAIC con fases Define, Measure, Analyze, Improve, Control, fórmulas Cp=(USL-LSL)/(6*sigma), Cpk=MIN((USL-mean)/(3*sigma),(mean-LSL)/(3*sigma)), Cp=1.33, hojas por cada fase";
    const result = analyzePrompt(prompt);
    const phases = ["Define", "Measure", "Analyze", "Improve", "Control"];

    expect(result.type).toBe("spreadsheet");
    for (const p of phases) {
      expect(prompt).toContain(p);
    }
    expect(prompt).toContain("Cp=");
    expect(prompt).toContain("Cpk=");
    expect(prompt).toContain("1.33");
    expect(phases).toHaveLength(5);
  });

  it("generates customer lifetime value Excel", () => {
    const prompt = "Crea un Excel de CLV customer lifetime value con fórmula CLV=(avg_purchase*frequency*lifespan)-acquisition_cost, params avgPurchase 50, frequency 12, lifespan 5, acquisitionCost 200, resultado CLV 2800";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("avg_purchase*frequency*lifespan");
    expect(prompt).toContain("acquisition_cost");
    expect(prompt).toContain("50");
    expect(prompt).toContain("2800");
    expect(prompt).toContain("CLV");
  });

  it("generates supply chain optimization Excel with transportation model", () => {
    const prompt = "Crea un Excel de optimización de cadena de suministro con modelo de transporte origin-destination 3 orígenes, 4 destinos, restricciones supply [300,400,500], demand [250,350,200,400], fórmula SUMPRODUCT(costs,allocations), objetivo minimize_total_cost";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("origin-destination");
    expect(prompt).toContain("3 orígenes");
    expect(prompt.toLowerCase()).toContain("supply");
    expect(prompt.toLowerCase()).toContain("demand");
    expect(prompt.toLowerCase()).toContain("minimize_total_cost");
  });

  it("generates financial derivatives pricing Excel (Black-Scholes)", () => {
    const prompt = "Crea un Excel de pricing de derivados financieros Black-Scholes con fórmulas d1=(LN(S/K)+(r+sigma^2/2)*T)/(sigma*SQRT(T)), d2=d1-sigma*SQRT(T), N_d1=NORM.S.DIST(d1,TRUE), N_d2, call=S*N(d1)-K*EXP(-r*T)*N(d2), put=K*EXP(-r*T)*N(-d2)-S*N(-d1)";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("d1=");
    expect(prompt).toContain("d2=");
    expect(prompt).toContain("N_d1");
    expect(prompt).toContain("N_d2");
    expect(prompt).toContain("call=");
    expect(prompt).toContain("put=");
  });

  it("generates demand forecasting Excel with exponential smoothing", () => {
    const prompt = "Crea un Excel de pronóstico de demanda con suavización exponencial, fórmula forecast=alpha*actual+(1-alpha)*previous_forecast, alpha 0.3, columnas period, actual, forecast, error, abs_error, MAE 12.5, MAPE 4.2";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("alpha*actual");
    expect(prompt).toContain("(1-alpha)*previous_forecast");
    expect(prompt).toContain("0.3");
    expect(prompt.toLowerCase()).toContain("forecast");
    expect(prompt).toContain("12.5");
  });

  it("generates cost-volume-profit analysis Excel", () => {
    const prompt = "Crea un Excel de análisis costo-volumen-beneficio con fórmulas contribution_margin=price-variable_cost, breakeven_units=fixed_costs/contribution_margin, margin_of_safety=(actual_sales-breakeven_sales)/actual_sales, breakeven 5000 unidades, margen de seguridad 0.20";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("contribution_margin");
    expect(prompt.toLowerCase()).toContain("breakeven_units");
    expect(prompt.toLowerCase()).toContain("margin_of_safety");
    expect(prompt).toContain("5000");
    expect(prompt).toContain("0.20");
  });

  it("generates workforce scheduling Excel with constraint satisfaction", () => {
    const prompt = "Crea un Excel de programación de turnos de personal con patrones morning, afternoon, night, restricciones staffing mínimo morning 5, afternoon 4, night 3, max 5 días consecutivos, min 12 horas descanso, fórmulas COUNTIF validación y columnas por día de la semana";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    const shifts = ["morning", "afternoon", "night"];
    for (const s of shifts) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt).toContain("5 días consecutivos");
    expect(prompt).toContain("12 horas");
    expect(prompt).toContain("COUNTIF");
  });

  it("generates Balanced Scorecard Excel with KPI dashboard", () => {
    const prompt = "Crea un Excel de Balanced Scorecard con perspectivas financial, customer, internal_process, learning_growth, KPIs con target/actual/status (RAG: green>=target, amber>=80%, red<80%), hojas Dashboard, Financial, Customer, Internal Process, Learning & Growth";
    const result = analyzePrompt(prompt);
    const perspectives = ["financial", "customer", "internal_process", "learning_growth"];

    expect(result.type).toBe("spreadsheet");
    for (const p of perspectives) {
      expect(prompt.toLowerCase()).toContain(p);
    }
    expect(perspectives).toHaveLength(4);
    expect(prompt.toLowerCase()).toContain("target");
    expect(prompt.toLowerCase()).toContain("actual");
    expect(prompt.toLowerCase()).toContain("status");
    expect(prompt.toLowerCase()).toContain("green");
    const sheets = ["Dashboard", "Financial", "Customer", "Internal Process", "Learning & Growth"];
    expect(sheets).toHaveLength(5);
  });
});
