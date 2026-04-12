/**
 * Capability tests — Finance use cases (capability 17-finance)
 *
 * Tests cover journal entries, bank reconciliation, financial statement
 * generation, and variance analysis. All tests operate on in-memory
 * data structures with no external service calls.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type DebitCredit = "debit" | "credit";

interface Account {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalBalance: DebitCredit;
}

interface JournalEntry {
  id: string;
  date: string;
  description: string;
  lines: JournalLine[];
  posted: boolean;
  period: string; // YYYY-MM
}

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number; // positive = credit to bank, negative = debit
  reference?: string;
}

interface LedgerEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: DebitCredit;
  reconciled: boolean;
  bankTransactionId?: string;
}

interface ReconciliationResult {
  matched: Array<{ bankTxId: string; ledgerEntryId: string; amount: number }>;
  unmatched_bank: BankTransaction[];
  unmatched_ledger: LedgerEntry[];
  variance: number;
}

interface IncomeStatement {
  revenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  period: string;
}

interface BalanceSheet {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  period: string;
}

interface VarianceReport {
  category: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
  favourable: boolean;
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

const CHART_OF_ACCOUNTS: Account[] = [
  { code: "1000", name: "Cash", type: "asset", normalBalance: "debit" },
  { code: "1100", name: "Accounts Receivable", type: "asset", normalBalance: "debit" },
  { code: "1200", name: "Inventory", type: "asset", normalBalance: "debit" },
  { code: "2000", name: "Accounts Payable", type: "liability", normalBalance: "credit" },
  { code: "2100", name: "Accrued Liabilities", type: "liability", normalBalance: "credit" },
  { code: "3000", name: "Common Stock", type: "equity", normalBalance: "credit" },
  { code: "3100", name: "Retained Earnings", type: "equity", normalBalance: "credit" },
  { code: "4000", name: "Revenue", type: "revenue", normalBalance: "credit" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", normalBalance: "debit" },
  { code: "6000", name: "Operating Expenses", type: "expense", normalBalance: "debit" },
  { code: "6100", name: "Salaries Expense", type: "expense", normalBalance: "debit" },
];

function lookupAccount(code: string): Account | undefined {
  return CHART_OF_ACCOUNTS.find((a) => a.code === code);
}

// ---------------------------------------------------------------------------
// Double-entry engine
// ---------------------------------------------------------------------------

function validateDoubleEntry(entry: JournalEntry): { valid: boolean; reason?: string } {
  if (entry.lines.length < 2) {
    return { valid: false, reason: "Journal entry must have at least 2 lines" };
  }

  const totalDebits = entry.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredits = entry.lines.reduce((sum, l) => sum + l.credit, 0);

  if (Math.abs(totalDebits - totalCredits) > 0.001) {
    return {
      valid: false,
      reason: `Debits ($${totalDebits.toFixed(2)}) must equal credits ($${totalCredits.toFixed(2)})`,
    };
  }

  for (const line of entry.lines) {
    if (line.debit < 0 || line.credit < 0) {
      return { valid: false, reason: "Debit and credit amounts cannot be negative" };
    }
    if (line.debit > 0 && line.credit > 0) {
      return { valid: false, reason: "A line cannot have both debit and credit amounts" };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Reconciliation engine
// ---------------------------------------------------------------------------

function reconcile(
  bankTransactions: BankTransaction[],
  ledgerEntries: LedgerEntry[],
  toleranceCents = 0,
): ReconciliationResult {
  const matched: ReconciliationResult["matched"] = [];
  const unmatchedBank = [...bankTransactions];
  const unmatchedLedger = [...ledgerEntries];

  for (const bank of bankTransactions) {
    const ledgerIdx = unmatchedLedger.findIndex(
      (l) => Math.abs(Math.abs(l.amount) - Math.abs(bank.amount)) <= toleranceCents / 100,
    );

    if (ledgerIdx >= 0) {
      const ledger = unmatchedLedger[ledgerIdx];
      matched.push({ bankTxId: bank.id, ledgerEntryId: ledger.id, amount: Math.abs(bank.amount) });
      unmatchedLedger.splice(ledgerIdx, 1);
      const bankIdx = unmatchedBank.findIndex((b) => b.id === bank.id);
      if (bankIdx >= 0) unmatchedBank.splice(bankIdx, 1);
    }
  }

  const bankTotal = bankTransactions.reduce((sum, t) => sum + t.amount, 0);
  const ledgerTotal = ledgerEntries.reduce((sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount), 0);

  return {
    matched,
    unmatched_bank: unmatchedBank,
    unmatched_ledger: unmatchedLedger,
    variance: Math.abs(bankTotal - ledgerTotal),
  };
}

// ---------------------------------------------------------------------------
// Financial statement builders
// ---------------------------------------------------------------------------

function buildIncomeStatement(journalEntries: JournalEntry[], period: string): IncomeStatement {
  let revenue = 0;
  let cogs = 0;
  let opex = 0;

  const periodEntries = journalEntries.filter((e) => e.period === period && e.posted);

  for (const entry of periodEntries) {
    for (const line of entry.lines) {
      const account = lookupAccount(line.accountCode);
      if (!account) continue;

      if (account.type === "revenue") {
        revenue += line.credit - line.debit;
      } else if (account.code === "5000") {
        cogs += line.debit - line.credit;
      } else if (account.type === "expense") {
        opex += line.debit - line.credit;
      }
    }
  }

  const grossProfit = revenue - cogs;
  const operatingIncome = grossProfit - opex;

  return {
    revenue,
    costOfGoodsSold: cogs,
    grossProfit,
    operatingExpenses: opex,
    operatingIncome,
    netIncome: operatingIncome, // simplified (no taxes/interest)
    period,
  };
}

function buildVarianceReport(
  budgetMap: Record<string, number>,
  actualMap: Record<string, number>,
  isRevenue = false,
): VarianceReport[] {
  return Object.keys(budgetMap).map((category) => {
    const budget = budgetMap[category] ?? 0;
    const actual = actualMap[category] ?? 0;
    const variance = actual - budget;
    const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;
    // For revenue: positive variance is favourable; for expenses: negative is favourable
    const favourable = isRevenue ? variance >= 0 : variance <= 0;
    return { category, budget, actual, variance, variancePct, favourable };
  });
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

describe("Journal entries", () => {
  it("validates a balanced double-entry journal entry", () => {
    const entry: JournalEntry = {
      id: "je_001",
      date: "2026-04-01",
      description: "Record sales revenue",
      period: "2026-04",
      posted: false,
      lines: [
        { accountCode: "1100", accountName: "Accounts Receivable", debit: 5000, credit: 0 },
        { accountCode: "4000", accountName: "Revenue", debit: 0, credit: 5000 },
      ],
    };

    const result = validateDoubleEntry(entry);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects an unbalanced journal entry", () => {
    const entry: JournalEntry = {
      id: "je_002",
      date: "2026-04-01",
      description: "Bad entry",
      period: "2026-04",
      posted: false,
      lines: [
        { accountCode: "1100", accountName: "Accounts Receivable", debit: 5000, credit: 0 },
        { accountCode: "4000", accountName: "Revenue", debit: 0, credit: 4500 }, // Doesn't balance
      ],
    };

    const result = validateDoubleEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Debits");
  });

  it("looks up accounts by code from the chart of accounts", () => {
    const cash = lookupAccount("1000");
    const revenue = lookupAccount("4000");
    const unknown = lookupAccount("9999");

    expect(cash?.name).toBe("Cash");
    expect(cash?.type).toBe("asset");
    expect(revenue?.normalBalance).toBe("credit");
    expect(unknown).toBeUndefined();
  });

  it("marks a journal entry as posted and prevents re-posting", () => {
    const entry: JournalEntry = {
      id: "je_003",
      date: "2026-04-02",
      description: "Post salary payment",
      period: "2026-04",
      posted: false,
      lines: [
        { accountCode: "6100", accountName: "Salaries Expense", debit: 8000, credit: 0 },
        { accountCode: "1000", accountName: "Cash", debit: 0, credit: 8000 },
      ],
    };

    function postEntry(entry: JournalEntry): JournalEntry {
      if (entry.posted) throw new Error("Entry already posted");
      return { ...entry, posted: true };
    }

    const posted = postEntry(entry);
    expect(posted.posted).toBe(true);
    expect(() => postEntry(posted)).toThrow("already posted");
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

describe("Reconciliation", () => {
  const bankTransactions: BankTransaction[] = [
    { id: "bt_001", date: "2026-04-01", description: "Payment from Client A", amount: 5000 },
    { id: "bt_002", date: "2026-04-02", description: "Supplier payment", amount: -1200 },
    { id: "bt_003", date: "2026-04-03", description: "Unknown credit", amount: 750 },
  ];

  const ledgerEntries: LedgerEntry[] = [
    { id: "le_001", date: "2026-04-01", description: "Client A invoice payment", amount: 5000, type: "credit", reconciled: false },
    { id: "le_002", date: "2026-04-02", description: "Supplier Invoice #123", amount: 1200, type: "debit", reconciled: false },
  ];

  it("matches bank transactions to ledger entries by amount", () => {
    const result = reconcile(bankTransactions, ledgerEntries);

    expect(result.matched).toHaveLength(2);
    expect(result.matched.find((m) => m.bankTxId === "bt_001")).toBeDefined();
    expect(result.matched.find((m) => m.bankTxId === "bt_002")).toBeDefined();
  });

  it("identifies unmatched bank transactions not in the ledger", () => {
    const result = reconcile(bankTransactions, ledgerEntries);

    expect(result.unmatched_bank).toHaveLength(1);
    expect(result.unmatched_bank[0].id).toBe("bt_003");
  });

  it("calculates the variance between bank and ledger totals", () => {
    const result = reconcile(bankTransactions, ledgerEntries);

    assertHasShape(result, {
      matched: "array",
      unmatched_bank: "array",
      unmatched_ledger: "array",
      variance: "number",
    });
    expect(result.variance).toBeGreaterThanOrEqual(0);
  });

  it("auto-matches transactions with zero variance when amounts are identical", () => {
    const bankOnly: BankTransaction[] = [
      { id: "b1", date: "2026-04-05", description: "Payment", amount: 2500 },
    ];
    const ledgerOnly: LedgerEntry[] = [
      { id: "l1", date: "2026-04-05", description: "Payment", amount: 2500, type: "credit", reconciled: false },
    ];

    const result = reconcile(bankOnly, ledgerOnly);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched_bank).toHaveLength(0);
    expect(result.unmatched_ledger).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

describe("Financial statements", () => {
  const journalEntries: JournalEntry[] = [
    {
      id: "je_rev_01",
      date: "2026-04-01",
      description: "Sales",
      period: "2026-04",
      posted: true,
      lines: [
        { accountCode: "1100", accountName: "AR", debit: 50000, credit: 0 },
        { accountCode: "4000", accountName: "Revenue", debit: 0, credit: 50000 },
      ],
    },
    {
      id: "je_cogs_01",
      date: "2026-04-01",
      description: "COGS",
      period: "2026-04",
      posted: true,
      lines: [
        { accountCode: "5000", accountName: "COGS", debit: 20000, credit: 0 },
        { accountCode: "1200", accountName: "Inventory", debit: 0, credit: 20000 },
      ],
    },
    {
      id: "je_opex_01",
      date: "2026-04-10",
      description: "Salaries",
      period: "2026-04",
      posted: true,
      lines: [
        { accountCode: "6100", accountName: "Salaries", debit: 15000, credit: 0 },
        { accountCode: "1000", accountName: "Cash", debit: 0, credit: 15000 },
      ],
    },
  ];

  it("generates a P&L statement from posted journal entries", () => {
    const pnl = buildIncomeStatement(journalEntries, "2026-04");

    expect(pnl.revenue).toBe(50000);
    expect(pnl.costOfGoodsSold).toBe(20000);
    expect(pnl.grossProfit).toBe(30000);
    expect(pnl.operatingExpenses).toBe(15000);
    expect(pnl.operatingIncome).toBe(15000);
    expect(pnl.period).toBe("2026-04");

    assertHasShape(pnl, {
      revenue: "number",
      costOfGoodsSold: "number",
      grossProfit: "number",
      operatingExpenses: "number",
      operatingIncome: "number",
      netIncome: "number",
    });
  });

  it("excludes unposted journal entries from financial statements", () => {
    const mixedEntries: JournalEntry[] = [
      ...journalEntries,
      {
        id: "je_draft",
        date: "2026-04-30",
        description: "Draft adjustment (not posted)",
        period: "2026-04",
        posted: false,
        lines: [
          { accountCode: "4000", accountName: "Revenue", debit: 0, credit: 10000 },
          { accountCode: "1100", accountName: "AR", debit: 10000, credit: 0 },
        ],
      },
    ];

    const pnl = buildIncomeStatement(mixedEntries, "2026-04");
    // Draft entry should not be included
    expect(pnl.revenue).toBe(50000); // Not 60000
  });

  it("returns zero for all figures when no entries exist for the period", () => {
    const pnl = buildIncomeStatement([], "2026-05");

    expect(pnl.revenue).toBe(0);
    expect(pnl.costOfGoodsSold).toBe(0);
    expect(pnl.netIncome).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Variance analysis
// ---------------------------------------------------------------------------

describe("Variance analysis", () => {
  it("computes budget vs actual variance for each category", () => {
    const budgets = { sales: 100000, marketing: 20000, engineering: 50000 };
    const actuals = { sales: 105000, marketing: 22000, engineering: 48000 };

    const reports = buildVarianceReport(budgets, actuals, false);

    const salesReport = reports.find((r) => r.category === "sales");
    expect(salesReport?.variance).toBe(5000);

    const engineeringReport = reports.find((r) => r.category === "engineering");
    expect(engineeringReport?.variance).toBe(-2000);

    reports.forEach((r) =>
      assertHasShape(r, {
        category: "string",
        budget: "number",
        actual: "number",
        variance: "number",
        variancePct: "number",
        favourable: "boolean",
      }),
    );
  });

  it("marks positive revenue variance as favourable", () => {
    const budgets = { revenue: 80000 };
    const actuals = { revenue: 90000 };

    const reports = buildVarianceReport(budgets, actuals, true);
    expect(reports[0].favourable).toBe(true);
    expect(reports[0].variance).toBe(10000);
  });

  it("marks positive expense variance as unfavourable (over budget)", () => {
    const budgets = { payroll: 50000 };
    const actuals = { payroll: 56000 };

    const reports = buildVarianceReport(budgets, actuals, false);
    expect(reports[0].favourable).toBe(false);
    expect(reports[0].variance).toBe(6000);
  });

  it("calculates variance percentage relative to budget", () => {
    const budgets = { travel: 10000 };
    const actuals = { travel: 8500 };

    const reports = buildVarianceReport(budgets, actuals, false);
    expect(reports[0].variancePct).toBeCloseTo(-15, 1); // 15% under budget
  });
});
