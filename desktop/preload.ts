import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    // Escuchar mensajes del proceso principal (Node) al Renderizador
    onNativeAction: (callback: (event: any, data: any) => void) =>
        ipcRenderer.on('native-action', callback),

    // Mandar mensajes desde React (Renderizador) hacía Node
    agentStarted: () => ipcRenderer.send('agent:started'),
    agentStopped: () => ipcRenderer.send('agent:stopped'),

    // Requerir información cruda del OS
    getSystemVolume: () => ipcRenderer.invoke('system:getVolume'),

    // Toggle Ignore Mouse Events (Para la transparencia overlay)
    setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('window:setIgnoreMouseEvents', ignore)
});
