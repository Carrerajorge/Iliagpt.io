import { TraceBus } from "./TraceBus";
import { ContractRequirements, DEFAULT_CONTRACT } from "./types";
import { AcademicCandidate } from "../openAlexClient";

interface ValidationResult {
  valid: boolean;
  violations: Array<{
    field: string;
    reason: string;
    severity: "error" | "warning";
  }>;
  coverage: Record<string, number>;
}

export class ContractGuard {
  private contract: ContractRequirements;
  private traceBus: TraceBus;
  private violations: ValidationResult["violations"] = [];

  constructor(traceBus: TraceBus, contract?: Partial<ContractRequirements>) {
    this.traceBus = traceBus;
    this.contract = { ...DEFAULT_CONTRACT, ...contract };
  }

  validateArticle(article: AcademicCandidate): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    if (!article.authors || article.authors.length === 0) {
      missingFields.push("Authors");
    }

    if (!article.title || article.title === "Unknown") {
      missingFields.push("Title");
    }

    if (!article.year || article.year === 0) {
      missingFields.push("Year");
    }

    if (article.year && (article.year < this.contract.year_range.start || article.year > this.contract.year_range.end)) {
      missingFields.push(`Year (out of range: ${this.contract.year_range.start}-${this.contract.year_range.end})`);
    }

    if (!article.journal || article.journal === "Unknown") {
      missingFields.push("Journal");
    }

    if (this.contract.must_have_doi && (!article.doi || article.doi === "Unknown")) {
      missingFields.push("DOI");
    }

    if (this.contract.must_have_access_url && !article.landingUrl && !article.doiUrl) {
      missingFields.push("Access_URL");
    }

    if (!article.city || article.city === "Unknown") {
      missingFields.push("City of publication");
    }

    if (!article.country || article.country === "Unknown") {
      missingFields.push("Country of study");
    }

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  validateBatch(articles: AcademicCandidate[]): ValidationResult {
    const coverage: Record<string, number> = {};
    const totalArticles = articles.length;

    const fieldChecks = [
      { field: "Authors", check: (a: AcademicCandidate) => a.authors && a.authors.length > 0 },
      { field: "Title", check: (a: AcademicCandidate) => a.title && a.title !== "Unknown" },
      { field: "Year", check: (a: AcademicCandidate) => a.year && a.year > 0 },
      { field: "Journal", check: (a: AcademicCandidate) => a.journal && a.journal !== "Unknown" },
      { field: "Abstract", check: (a: AcademicCandidate) => a.abstract && a.abstract.length > 50 },
      { field: "Keywords", check: (a: AcademicCandidate) => a.keywords && a.keywords.length > 0 },
      { field: "Language", check: (a: AcademicCandidate) => a.language && a.language !== "Unknown" },
      { field: "Document Type", check: (a: AcademicCandidate) => a.documentType && a.documentType !== "Unknown" },
      { field: "DOI", check: (a: AcademicCandidate) => a.doi && a.doi !== "Unknown" },
      { field: "City of publication", check: (a: AcademicCandidate) => a.city && a.city !== "Unknown" },
      { field: "Country of study", check: (a: AcademicCandidate) => a.country && a.country !== "Unknown" },
      { field: "Access_URL", check: (a: AcademicCandidate) => a.landingUrl || a.doiUrl },
    ];

    for (const { field, check } of fieldChecks) {
      const validCount = articles.filter(check).length;
      coverage[field] = Math.round((validCount / totalArticles) * 100);
    }

    this.violations = [];

    if (totalArticles < this.contract.min_articles) {
      this.violations.push({
        field: "Total Articles",
        reason: `Only ${totalArticles} articles, required ${this.contract.min_articles}`,
        severity: "error",
      });
    }

    const criticalFields = ["Authors", "Title", "Year", "DOI"];
    for (const field of criticalFields) {
      if (coverage[field] < 90) {
        this.violations.push({
          field,
          reason: `Coverage ${coverage[field]}% is below 90%`,
          severity: "error",
        });
      }
    }

    const importantFields = ["Journal", "Abstract", "Keywords"];
    for (const field of importantFields) {
      if (coverage[field] < 70) {
        this.violations.push({
          field,
          reason: `Coverage ${coverage[field]}% is below 70%`,
          severity: "warning",
        });
      }
    }

    if (coverage["City of publication"] < 30) {
      this.violations.push({
        field: "City of publication",
        reason: `Coverage ${coverage["City of publication"]}% is below 30%`,
        severity: "warning",
      });
    }

    if (coverage["Country of study"] < 50) {
      this.violations.push({
        field: "Country of study",
        reason: `Coverage ${coverage["Country of study"]}% is below 50%`,
        severity: "warning",
      });
    }

    const hasErrors = this.violations.some(v => v.severity === "error");

    if (hasErrors) {
      for (const violation of this.violations.filter(v => v.severity === "error")) {
        this.traceBus.contractViolation("ContractGuard", violation.reason, {
          missing_fields: [violation.field],
          fail_reason: violation.reason,
        });
      }
    }

    return {
      valid: !hasErrors,
      violations: this.violations,
      coverage,
    };
  }

  canComplete(): boolean {
    return !this.violations.some(v => v.severity === "error");
  }

  getViolations(): ValidationResult["violations"] {
    return [...this.violations];
  }

  getCoverageReport(): string {
    const lines: string[] = [];
    lines.push("## Field Coverage Report");
    lines.push("");

    for (const violation of this.violations) {
      const icon = violation.severity === "error" ? "❌" : "⚠️";
      lines.push(`${icon} **${violation.field}**: ${violation.reason}`);
    }

    return lines.join("\n");
  }
}

export function createContractGuard(traceBus: TraceBus, contract?: Partial<ContractRequirements>): ContractGuard {
  return new ContractGuard(traceBus, contract);
}
