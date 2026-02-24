/**
 * Test Script for Scientific Article Search
 * 
 * Run with: npx tsx server/agent/superAgent/testArticleSearch.ts
 */

import { searchAllSources, generateAPACitationsList } from "./unifiedArticleSearch";
import { searchPubMed, isPubMedConfigured } from "./pubmedClient";
import { searchSciELO, isSciELOConfigured } from "./scieloClient";
import { searchRedalyc, isRedalycConfigured } from "./redalycClient";
import { searchScopus, isScopusConfigured } from "./scopusClient";
import * as fs from "fs";
import * as path from "path";

async function testArticleSearch() {
    console.log("=".repeat(80));
    console.log("Scientific Article Search Test");
    console.log("=".repeat(80));
    console.log();

    // Check configuration
    console.log("API Configuration Status:");
    console.log(`  - PubMed: ${isPubMedConfigured() ? "✅ Ready (free)" : "❌ Not configured"}`);
    console.log(`  - SciELO: ${isSciELOConfigured() ? "✅ Ready (free)" : "❌ Not configured"}`);
    console.log(`  - Redalyc: ${isRedalycConfigured() ? "✅ Ready (free/token optional)" : "❌ Not configured"}`);
    console.log(`  - Scopus: ${isScopusConfigured() ? "✅ Ready (API key configured)" : "⚠️ API key required"}`);
    console.log();

    const query = "embarazo";
    const maxResults = 100;
    console.log(`Searching for: "${query}" (max ${maxResults} articles)`);
    console.log();

    // Test individual sources
    console.log("-".repeat(40));
    console.log("Testing Individual Sources");
    console.log("-".repeat(40));

    // PubMed
    console.log("\n[1] PubMed...");
    try {
        const pubmedResult = await searchPubMed("pregnancy maternal health", { maxResults: 10 });
        console.log(`    Found: ${pubmedResult.totalResults} total, ${pubmedResult.articles.length} returned`);
        if (pubmedResult.articles.length > 0) {
            console.log(`    Sample: "${pubmedResult.articles[0].title.substring(0, 60)}..."`);
        }
    } catch (error: any) {
        console.log(`    Error: ${error.message}`);
    }

    // SciELO
    console.log("\n[2] SciELO...");
    try {
        const scieloResult = await searchSciELO("embarazo gestación", { maxResults: 10 });
        console.log(`    Found: ${scieloResult.totalResults} total, ${scieloResult.articles.length} returned`);
        if (scieloResult.articles.length > 0) {
            console.log(`    Sample: "${scieloResult.articles[0].title.substring(0, 60)}..."`);
        }
    } catch (error: any) {
        console.log(`    Error: ${error.message}`);
    }

    // Redalyc
    console.log("\n[3] Redalyc...");
    try {
        const redalycResult = await searchRedalyc("embarazo", { maxResults: 10 });
        console.log(`    Found: ${redalycResult.totalResults} total, ${redalycResult.articles.length} returned`);
        if (redalycResult.articles.length > 0) {
            console.log(`    Sample: "${redalycResult.articles[0].title.substring(0, 60)}..."`);
        }
    } catch (error: any) {
        console.log(`    Error: ${error.message}`);
    }

    // Scopus (if configured)
    if (isScopusConfigured()) {
        console.log("\n[4] Scopus...");
        try {
            const scopusResult = await searchScopus("pregnancy", { maxResults: 10 });
            console.log(`    Found: ${scopusResult.totalResults} total, ${scopusResult.articles.length} returned`);
            if (scopusResult.articles.length > 0) {
                console.log(`    Sample: "${scopusResult.articles[0].title.substring(0, 60)}..."`);
            }
        } catch (error: any) {
            console.log(`    Error: ${error.message}`);
        }
    }

    // Unified Search
    console.log("\n" + "=".repeat(80));
    console.log("Testing Unified Search");
    console.log("=".repeat(80));

    try {
        const result = await searchAllSources(query, {
            maxResults: maxResults,
            maxPerSource: 30, // 30 per source to get ~100 total
        });

        console.log(`\nResults Summary:`);
        console.log(`  - Total articles: ${result.articles.length}`);
        console.log(`  - Scopus: ${result.totalBySource.scopus}`);
        console.log(`  - PubMed: ${result.totalBySource.pubmed}`);
        console.log(`  - SciELO: ${result.totalBySource.scielo}`);
        console.log(`  - Redalyc: ${result.totalBySource.redalyc}`);
        console.log(`  - Search time: ${result.searchTime}ms`);

        if (result.errors.length > 0) {
            console.log(`  - Errors: ${result.errors.join(", ")}`);
        }

        // Show first 5 articles
        console.log("\nFirst 5 articles:");
        for (let i = 0; i < Math.min(5, result.articles.length); i++) {
            const article = result.articles[i];
            console.log(`\n  ${i + 1}. [${article.source.toUpperCase()}] ${article.title.substring(0, 70)}...`);
            console.log(`     Authors: ${article.authors.slice(0, 3).join("; ")}${article.authors.length > 3 ? "..." : ""}`);
            console.log(`     Year: ${article.year} | Journal: ${article.journal.substring(0, 40)}`);
        }

        // Generate APA citations list
        if (result.articles.length > 0) {
            const citationsText = generateAPACitationsList(result.articles);
            console.log("\n" + "=".repeat(80));
            console.log("FULL CITATIONS LIST STARTS HERE");
            console.log("=".repeat(80));
            console.log(citationsText);
            console.log("=".repeat(80));
            console.log("FULL CITATIONS LIST ENDS HERE");
        }

    } catch (error: any) {
        console.error(`Unified search error: ${error.message}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("Test Complete");
    console.log("=".repeat(80));
}

// Run test
testArticleSearch().catch(console.error);
