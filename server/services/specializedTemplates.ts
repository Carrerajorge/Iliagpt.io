export interface SpecializedTemplate {
    id: string;
    name: string;
    description: string;
    category: "academic" | "legal" | "financial" | "technical" | "general";
    markdownTemplate: string;
}

export const specializedTemplates: Record<string, SpecializedTemplate> = {
    academic_paper: {
        id: "academic_paper",
        name: "Academic Paper (IMRyD)",
        description: "Standard academic paper format with Introduction, Methods, Results, and Discussion.",
        category: "academic",
        markdownTemplate: `# [Paper Title]

**Authors:** [Author Names]
**Institution:** [Institution Name]
**Abstract:**
[A brief summary of the paper, including objectives, methods, key results, and conclusion.]

## 1. Introduction
[Background information, statement of the problem, and research objectives.]

## 2. Methods
[Detailed description of the research design, participants, materials, and procedures.]

## 3. Results
[Presentation of the findings without interpretation. Use tables and figures if necessary.]

## 4. Discussion
[Interpretation of the results, implications, limitations, and future research directions.]

## 5. Conclusion
[Final summary and closing remarks.]

## 6. References
[List of citations in standard format e.g., APA]
`
    },

    legal_contract: {
        id: "legal_contract",
        name: "Standard Legal Contract",
        description: "A generic template for a standard legal agreement between two parties.",
        category: "legal",
        markdownTemplate: `# [AGREEMENT TITLE]

This Agreement (the "Agreement") is entered into as of [Date] (the "Effective Date") by and between:

**Party A:** [Full Legal Name of Party A], located at [Address of Party A] ("Party A")
AND
**Party B:** [Full Legal Name of Party B], located at [Address of Party B] ("Party B")

## 1. Scope of Agreement
[Define the scope and purpose of the agreement.]

## 2. Terms and Conditions
[Detail the specific terms, responsibilities, and obligations of both parties.]

## 3. Compensation & Payment
[Outline the financial terms, payment schedule, and terms.]

## 4. Confidentiality
[State confidentiality requirements if applicable.]

## 5. Term and Termination
[Define the duration of the agreement and conditions for termination.]

## 6. Governing Law
This Agreement shall be governed by and construed in accordance with the laws of [Jurisdiction].

**IN WITNESS WHEREOF**, the Parties hereto have executed this Agreement as of the Effective Date.

**Party A:** _________________________ Date: _________
**Party B:** _________________________ Date: _________
`
    },

    financial_report: {
        id: "financial_report",
        name: "Quarterly Financial Report",
        description: "Template for summarizing financial performance over a given quarter.",
        category: "financial",
        markdownTemplate: `# Financial Report: [Quarter/Year]

**Company:** [Company Name]
**Prepared By:** [Analyst/Author Name]
**Date:** [Date]

## 1. Executive Summary
[Brief overview of financial health, key highlights, and major events of the quarter.]

## 2. Financial Highlights
- **Total Revenue:** [$X,XXX,XXX]
- **Net Income:** [$X,XXX,XXX]
- **EBITDA:** [$X,XXX,XXX]
- **Earnings Per Share (EPS):** [$X.XX]

## 3. Revenue Analysis
[Breakdown of revenue streams, year-over-year (YoY) growth, and market performance.]

## 4. Expenses and Operating Costs
[Details on COGS, operating expenses, and cost-saving measures.]

## 5. Cash Flow & Balance Sheet Overview
[Summary of cash position, assets, liabilities, and equity.]

## 6. Outlook and Projections
[Forward-looking statements, risks, and strategic guidance for the next quarter.]
`
    }
};

export function getSpecializedTemplate(id: string): SpecializedTemplate | undefined {
    return specializedTemplates[id];
}

export function getAllSpecializedTemplates(): SpecializedTemplate[] {
    return Object.values(specializedTemplates);
}

export function getTemplatesByCategory(category: string): SpecializedTemplate[] {
    return Object.values(specializedTemplates).filter(t => t.category === category);
}
