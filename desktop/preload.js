const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSystemVolume: () => ipcRenderer.invoke('system:getVolume'),
    // Aquí se expondrá la API de control total hacia el cliente web
});
