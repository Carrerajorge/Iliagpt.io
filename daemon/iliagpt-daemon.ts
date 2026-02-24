import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import { createServer } from 'net';

const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\iliagpt-daemon'
    : '/tmp/iliagpt.sock';

let nativeBridge: any = null; // Mock variable for native bridge loading status

// T02-001: Daemon Process Monitor (Health / Metrics Endpoint)
// Health endpoint via HTTP alongside Unix Socket
const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        const mem = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            uptime: process.uptime(),
            memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
            nativeBridge: !!nativeBridge,
            pid: process.pid,
            platform: os.platform(),
            timestamp: Date.now()
        }));
    } else if (req.url === '/metrics') {
        // Prometheus format
        const mem = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end([
            `# HELP iliagpt_daemon_uptime_seconds Daemon uptime`,
            `iliagpt_daemon_uptime_seconds ${process.uptime()}`,
            `# HELP iliagpt_daemon_memory_rss_bytes RSS memory`,
            `iliagpt_daemon_memory_rss_bytes ${mem.rss}`,
            `# HELP iliagpt_daemon_native_bridge_loaded Native bridge status`,
            `iliagpt_daemon_native_bridge_loaded ${nativeBridge ? 1 : 0}`,
        ].join('\n'));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const HEALTH_PORT = parseInt(process.env.DAEMON_HEALTH_PORT || '13375');
healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {
    console.log(`[Daemon] Health endpoint on http://127.0.0.1:${HEALTH_PORT}/health`);
});

// IPC Server Base
const server = createServer((client) => {
    client.on('data', (data) => {
        // Handle IPC commands
    });
});

if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
    try {
        fs.unlinkSync(SOCKET_PATH);
    } catch { }
}

server.listen(SOCKET_PATH, () => {
    console.log(`[Daemon] Listening on ${SOCKET_PATH}`);
});

// Watchdog placeholder
const watchdogInterval = setInterval(() => {
    // Check main app status
}, 30000);

// T02-003: Graceful Shutdown & Crash Recovery
// Agregar al final del archivo:
process.on('uncaughtException', (err) => {
    console.error('[Daemon] Uncaught Exception:', err);
    // Write crash dump
    const crashDump = {
        timestamp: new Date().toISOString(),
        error: err.message,
        stack: err.stack,
        memory: process.memoryUsage(),
        uptime: process.uptime()
    };
    try {
        fs.writeFileSync('/tmp/iliagpt-crash.json', JSON.stringify(crashDump, null, 2));
    } catch { }
    process.exit(1); // LaunchDaemon KeepAlive will restart
});

process.on('unhandledRejection', (reason) => {
    console.error('[Daemon] Unhandled Rejection:', reason);
});

// Graceful shutdown for all signals
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
        console.log(`[Daemon] ${signal} received, graceful shutdown...`);
        clearInterval(watchdogInterval as any);
        healthServer.close();
        server.close(() => {
            if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
                fs.unlinkSync(SOCKET_PATH);
            }
            process.exit(0);
        });
        // Force kill after 10s
        setTimeout(() => process.exit(1), 10000);
    });
}
