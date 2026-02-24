
import { generateExcelReport, UnifiedArticle } from "../agent/superAgent/unifiedArticleSearch";
import * as fs from "fs";
import * as path from "path";

function test() {
    console.log("Testing Excel Generation...");

    const mockArticles: UnifiedArticle[] = [
        {
            id: "1",
            source: "scopus",
            title: "Circular Economy in Latin America",
            authors: ["Perez, J.", "Garcia, M."],
            year: "2023",
            journal: "Journal of Cleaner Production",
            abstract: "This paper analyzes...",
            keywords: ["circular economy", "latam"],
            language: "English",
            documentType: "Article",
            country: "Mexico",
            city: "Mexico City",
            doi: "10.1016/j.jclepro.2023.123456",
            url: "http://example.com",
            apaCitation: "Perez, J. (2023). ..."
        },
        {
            id: "2",
            source: "scielo",
            title: "Economía Circular en PyMEs",
            authors: ["Lopez, A."],
            year: "2022",
            journal: "Revista de Gestión",
            abstract: "Estudio de caso...",
            keywords: ["pymes", "economía circular"],
            language: "Spanish",
            documentType: "Article",
            country: "Colombia",
            city: "Bogota",
            url: "http://example.com",
            apaCitation: "Lopez, A. (2022). ..."
        }
    ];

    try {
        const buffer = generateExcelReport(mockArticles);
        const outputPath = path.join(process.cwd(), "test_excel_output.xlsx");
        fs.writeFileSync(outputPath, buffer);
        console.log(`Excel file created at: ${outputPath}`);
        console.log(`Buffer size: ${buffer.length} bytes`);
    } catch (e) {
        console.error("Error generating Excel:", e);
    }
}

test();
