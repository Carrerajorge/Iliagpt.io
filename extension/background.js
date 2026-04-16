// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('ILIAGPT Extension installed');
});

// Listener to communicate with ILIAGPT Local Server (Desktop App)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'execute_agent_script') {
        // Forward script execution to the content script of the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, request, function (response) {
                    sendResponse(response);
                });
            }
        });
        return true; // Keep channel open for async response
    }
});
