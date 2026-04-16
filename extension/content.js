// Content script injected into all pages

console.log("ILIAGPT Extension Context: Ready to receive commands.");

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'execute_agent_script') {
        try {
            // We evaluate the script in the context of the page
            // Be extremely careful with this in production. Sanitize inputs on the server.
            console.log("ILIAGPT executing agent script:", request.script);

            // Execute the script
            // Note: In MV3, eval() might be restricted depending on CSP, but since we are injecting
            // as a content script, we can interact with the DOM directly.
            // For complex JS execution, we might need to inject a script tag.

            // Basic DOM execution
            const executeFunction = new Function('document', 'window', request.script);
            const rawResult = executeFunction(document, window);

            // Serialize result
            let result;
            if (rawResult instanceof Element || rawResult instanceof Node) {
                result = "DOM Element Reference";
            } else {
                result = JSON.stringify(rawResult);
            }

            sendResponse({ success: true, result: result });
        } catch (error) {
            console.error("ILIAGPT script execution error:", error);
            sendResponse({ success: false, error: error.message });
        }
    }

    // Return true to indicate asynchronous response handler if needed later
    return true;
});
