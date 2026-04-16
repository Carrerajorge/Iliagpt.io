
import { academicSearchService } from "./academicSearchService";

async function test() {
    console.log("Testing General Academic Search...");
    try {
        const result = await academicSearchService.processResearchRequest(
            "investigar sobre inteligencia artificial en medicina"
        );
        console.log("Summary:", result.summary);
        console.log("File Path:", result.filePath);

        // Check if file exists
        // import fs
        const fs = require('fs');
        if (fs.existsSync(result.filePath)) {
            console.log("File created successfully.");
            // console.log(fs.readFileSync(result.filePath, 'utf-8').substring(0, 200) + "...");
        } else {
            console.error("File NOT created.");
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

test();
