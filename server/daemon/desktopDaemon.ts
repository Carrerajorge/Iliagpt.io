import { createServer } from "http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Important: Require the Node addon dynamically or specifically
import * as path from "path";
let nativeDesktop: any;
try {
    const isPackaged = process.title === "IliaGPT" || __dirname.includes("app.asar");
    if (isPackaged || process.env.NODE_ENV === "production" && __dirname.includes("app.asar")) {
        const resPath = process.resourcesPath || path.join(__dirname, "../..");
        nativeDesktop = require(path.join(resPath, "native", "iliagpt-native.node"));
    } else {
        nativeDesktop = require("../../native/iliagpt-native.node");
    }
} catch (e: any) {
    console.error("Daemond FAILED TO LOAD C++ MODULE: ", e.message);
}

// ── Configuration ──────────────────────────────────────────────────────
const DAEMON_PORT = process.env.DAEMON_PORT ? parseInt(process.env.DAEMON_PORT) : 13374;
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(express.json());

// ── HTTP API ─────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        os: process.platform,
        nativeLoaded: !!nativeDesktop,
        exports: nativeDesktop ? Object.keys(nativeDesktop) : []
    });
});

app.post("/action", async (req, res) => {
    try {
        const payload = req.body;

        // Router de acciones crudas para el Hypervisor (MCTS)
        let result: any = null;
        switch (payload.type) {
            case "mouse_click":
                if (process.platform === 'win32') nativeDesktop.mouseClickWin(payload.x, payload.y, payload.button || 1);
                else nativeDesktop.mouseClick(payload.x, payload.y, payload.button || 1);
                result = true;
                break;
            case "mouse_move":
                if (process.platform === 'win32') nativeDesktop.mouseMoveWin(payload.x, payload.y);
                else nativeDesktop.mouseMove(payload.x, payload.y);
                result = true;
                break;
            case "keyboard_type":
                if (process.platform === 'win32') nativeDesktop.keyboardTypeWin(payload.text);
                else nativeDesktop.keyboardType(payload.text);
                result = true;
                break;
            case "keyboard_press":
                if (process.platform === 'win32') nativeDesktop.keyboardPressWin(payload.keyName);
                else nativeDesktop.keyboardPress(payload.keyName);
                result = true;
                break;
            case "capture_screen":
                const frameBuf = process.platform === 'win32' ? nativeDesktop.captureScreenWin() : nativeDesktop.captureScreen();
                result = Buffer.from(frameBuf).toString("base64");
                break;
            case "get_focused_element":
                result = process.platform === 'win32' ? nativeDesktop.getFocusedElementWin() : nativeDesktop.getFocusedElement();
                break;
            case "get_element_tree":
                // hWnd stub as param or null equivalent
                result = process.platform === 'win32' ? nativeDesktop.getElementTreeWin(0) : nativeDesktop.getElementTree();
                break;
            case "list_windows":
                result = process.platform === 'win32' ? nativeDesktop.listWindowsWin() : nativeDesktop.listWindows();
                break;
            case "execute_applescript":
                if (process.platform === 'win32') throw new Error("AppleScript not supported on Windows");
                result = nativeDesktop.executeApplescript(payload.script);
                break;
            default:
                return res.status(400).json({ error: "Unknown action type: " + payload.type });
        }

        res.json({ success: true, payload: result });

    } catch (e: any) {
        console.error("Local Daemon Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ── WebSocket (Video Streaming / Continuous Capture) ─────────────────

const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
    console.log("[Daemon] New WS connection established");
    clients.add(ws);

    ws.on("close", () => {
        clients.delete(ws);
    });

    // In Fase 4.2 this could receive commands too, but HTTP is fine for now
    ws.on("message", (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === "subscribe_vision") {
                // The Daemon will push bytes directly from "captureScreen"
            }
        } catch (e) { }
    });
});

// Mock frame loop
let capturing = false;
export function startDaemonCaptureLoop(fps: number) {
    if (capturing) return;
    capturing = true;

    setInterval(async () => {
        if (clients.size === 0) return; // Save CPU
        try {
            // Mac OS Screen API Native
            const frameBuffer = nativeDesktop.captureScreen();
            const payload = JSON.stringify({
                type: "vision_frame",
                timestamp: Date.now(),
                frameStr: Buffer.from(frameBuffer).toString("base64")
            });

            clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                    c.send(payload);
                }
            });
        } catch (e) {
            console.error("[Daemon] Capture loop failed:", e);
        }
    }, 1000 / fps);
}


// ──  Startup ─────────────────────────────────────────────────────────

httpServer.listen(DAEMON_PORT, () => {
    console.log(`[ILIO-DAEMON] Native OS Control Layer running on local port ${DAEMON_PORT}`);
    startDaemonCaptureLoop(1); // Default to low-cpu checking
});
