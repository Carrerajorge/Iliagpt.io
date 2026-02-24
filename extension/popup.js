document.addEventListener('DOMContentLoaded', () => {
    // Read manifest version
    const manifestData = chrome.runtime.getManifest();
    document.getElementById('versionLabel').textContent = manifestData.version;

    document.getElementById('openPlatformBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: "http://localhost:5050" }); // For development. Uses actual domain in prod.
    });

    document.getElementById('extractBtn').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'execute_agent_script',
                    script: 'return document.body.innerText;'
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        console.error('Error communicating with content script:', chrome.runtime.lastError);
                        alert("Error connecting to the page. Try refreshing it.");
                    } else {
                        console.log("Extraction complete", response);
                        alert("Extraction sent to backend (mock). Check console.");
                    }
                });
            }
        });
    });
});
