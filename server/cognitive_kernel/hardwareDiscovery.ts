import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

export interface HardwareProfile {
    cpu: {
        cores: number;
        performanceCores?: number;
        efficiencyCores?: number;
        model: string;
        architecture: string;
    };
    gpu: {
        metalEnabled: boolean;
        cores?: number;
        description?: string;
    };
    memory: {
        totalGB: number;
        freeGB: number;
    };
    neuralEngine: {
        present: boolean;
        cores?: number;
    };
    os: {
        platform: string;
        release: string;
        version: string;
    };
}

export function discoverHardware(): HardwareProfile {
    const profile: HardwareProfile = {
        cpu: {
            cores: os.cpus().length,
            model: os.cpus()[0]?.model || 'Unknown',
            architecture: os.arch(),
        },
        gpu: {
            metalEnabled: false,
        },
        memory: {
            totalGB: parseFloat((os.totalmem() / (1024 ** 3)).toFixed(2)),
            freeGB: parseFloat((os.freemem() / (1024 ** 3)).toFixed(2)),
        },
        neuralEngine: {
            present: false,
        },
        os: {
            platform: os.platform(),
            release: os.release(),
            version: os.version(),
        }
    };

    if (os.platform() === 'darwin' && os.arch() === 'arm64') {
        try {
            // Get detailed CPU cores (perf vs efficiency)
            const perfCoresStr = execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu']).toString().trim();
            const effCoresStr = execFileSync('sysctl', ['-n', 'hw.perflevel1.physicalcpu']).toString().trim();
            profile.cpu.performanceCores = parseInt(perfCoresStr, 10);
            profile.cpu.efficiencyCores = parseInt(effCoresStr, 10);

            // Check for ANE (Apple Neural Engine) - usually implicitly present on Apple Silicon
            profile.neuralEngine.present = true;
            profile.neuralEngine.cores = 16; // Standard baseline for M-series, could be verified deeper

            // Metal GPU checks
            const systemProfiler = execFileSync('system_profiler', ['SPDisplaysDataType']).toString();
            if (systemProfiler.includes('Metal') || systemProfiler.includes('Apple')) {
                profile.gpu.metalEnabled = true;
                const coresMatch = systemProfiler.match(/Total Number of Cores: (\d+)/);
                if (coresMatch && coresMatch[1]) {
                    profile.gpu.cores = parseInt(coresMatch[1], 10);
                } else {
                    // If not detailed, fallback to some sysctl inference if possible, but keep undefined for now
                }
                profile.gpu.description = systemProfiler.split('\n').find(line => line.includes('Chipset Model'))?.split(':')[1]?.trim() || 'Apple GPU';
            }
        } catch (e) {
            console.warn('[HardwareDiscovery] Failed to probe detailed Apple Silicon specs via sysctl/system_profiler', (e as Error).message);
        }
    }

    return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log('--- Hardware Discovery ---');
    console.log(JSON.stringify(discoverHardware(), null, 2));
}
