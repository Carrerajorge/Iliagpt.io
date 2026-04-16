import { vi } from "vitest";

export interface MockLLMResponse {
  code: string;
  summary: string;
  metrics: Record<string, string | number>;
}

const DETERMINISTIC_RESPONSES: Record<string, MockLLMResponse> = {
  default: {
    code: `import pandas as pd
df = pd.read_csv("data.csv")
print(df.describe())
result = {"row_count": len(df), "columns": list(df.columns)}`,
    summary: "Dataset contains structured data with multiple columns. Basic statistical analysis performed.",
    metrics: {
      "Row Count": "100",
      "Column Count": "5",
      "Data Quality": "Good",
    },
  },
  sales: {
    code: `import pandas as pd
df = pd.read_excel("data.xlsx", sheet_name="Sales")
total_sales = df["Total"].sum()
avg_transaction = df["Total"].mean()
print(f"Total Sales: ${total_sales}")`,
    summary: "Sales data with transaction records. Total revenue calculated from all transactions.",
    metrics: {
      "Total Sales": "$15,450",
      "Avg Transaction": "$1,545",
      "Transaction Count": "10",
    },
  },
  employees: {
    code: `import pandas as pd
df = pd.read_excel("data.xlsx", sheet_name="Employees")
avg_salary = df["Salary"].mean()
print(f"Average Salary: ${avg_salary}")`,
    summary: "Employee records with salary information. Average compensation analyzed.",
    metrics: {
      "Employee Count": "5",
      "Avg Salary": "$72,000",
      "Department Count": "3",
    },
  },
  large: {
    code: `import pandas as pd
df = pd.read_excel("data.xlsx", sheet_name="SalesData")
print(f"Total Rows: {len(df)}")
print(df.groupby("Category").agg({"Total": "sum"}))`,
    summary: "Large dataset with 10,000 sales records across multiple categories and regions.",
    metrics: {
      "Total Rows": "10,000",
      "Categories": "4",
      "Regions": "5",
      "Total Revenue": "$2,500,000",
    },
  },
};

export function getMockLLMResponse(sheetName: string): MockLLMResponse {
  const lowerName = sheetName.toLowerCase();
  if (lowerName.includes("sales") && !lowerName.includes("data")) {
    return DETERMINISTIC_RESPONSES.sales;
  }
  if (lowerName.includes("employee")) {
    return DETERMINISTIC_RESPONSES.employees;
  }
  if (lowerName.includes("10k") || lowerName.includes("large") || lowerName.includes("salesdata")) {
    return DETERMINISTIC_RESPONSES.large;
  }
  return DETERMINISTIC_RESPONSES.default;
}

export function createMockLLMGateway() {
  return {
    generateAnalysisCode: vi.fn().mockImplementation(async (sheetName: string, _context: any) => {
      const response = getMockLLMResponse(sheetName);
      return {
        code: response.code,
        summary: response.summary,
      };
    }),

    generateCrossSheetSummary: vi.fn().mockImplementation(async (_sheets: string[], _results: any) => {
      return "Cross-sheet analysis complete. Data shows consistent patterns across all sheets with strong correlation between sales and employee performance metrics.";
    }),

    streamCompletion: vi.fn().mockImplementation(async function* (_prompt: string) {
      yield "Analysis ";
      yield "complete. ";
      yield "Results ";
      yield "generated.";
    }),
  };
}

export function mockLLMGatewayModule() {
  vi.mock("../../services/llmGateway", () => ({
    llmGateway: createMockLLMGateway(),
    generateAnalysisCode: vi.fn().mockImplementation(async (sheetName: string) => {
      const response = getMockLLMResponse(sheetName);
      return { code: response.code, summary: response.summary };
    }),
  }));
}

export const MOCK_STREAMING_RESPONSE = {
  type: "message",
  content: "Mock LLM response for testing. No real API calls made.",
  model: "mock-grok-3-fast",
  tokens: { prompt: 100, completion: 50 },
};

export function assertNoRealLLMCalls(fetchMock: any) {
  const llmEndpoints = [
    "/api/llm/",
    "/api/generate/",
    "/v1/chat/completions",
    "api.x.ai",
    "generativelanguage.googleapis.com",
  ];

  for (const call of fetchMock.calls || []) {
    const url = typeof call === "string" ? call : call[0];
    for (const endpoint of llmEndpoints) {
      if (url?.includes(endpoint)) {
        throw new Error(`Real LLM call detected to: ${url}. Tests must use mocks.`);
      }
    }
  }
}
