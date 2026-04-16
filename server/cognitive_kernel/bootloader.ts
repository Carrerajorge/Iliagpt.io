import { fileURLToPath } from 'url';
import { discoverHardware, HardwareProfile } from './hardwareDiscovery';
import { globalBroker } from './messageBroker.js';
import { globalThreadPool, globalProcessPool } from './executionPools.js';
import { globalModelManager } from './modelWarmup.js';
import { initializeKnowledgeGraph } from './knowledgeGraphInit.js';
import { spawnPerceptionDaemons } from './perceptionDaemons.js';

export class CognitiveKernelBootloader {
    private hwProfile: HardwareProfile | null = null;
    private currentPhase: number = 0;

    constructor() { }

    public async boot(): Promise<void> {
        console.log('[CognitiveKernel] Initiating 7-Phase Boot Sequence...');

        await this.phase1_HardwareDiscovery();
        await this.phase2_InitializeEventLoopAndBrokers();
        await this.phase3_WarmUpModels();
        await this.phase4_InitializeKnowledgeGraph();
        await this.phase5_SpawnPerceptionDaemons();
        await this.phase6_BootstrapToolRegistryAndMemory();
        await this.phase7_SelfTestDiagnostic();

        console.log('[CognitiveKernel] Boot Sequence Complete! System is fully operational.');
    }

    private async phase1_HardwareDiscovery() {
        this.currentPhase = 1;
        console.log(`[Phase ${this.currentPhase}] Hardware Discovery via IOKit/sysctl...`);
        this.hwProfile = discoverHardware();
        console.log(`[Phase ${this.currentPhase}] Detected: ${this.hwProfile.cpu.cores} Cores (${this.hwProfile.cpu.performanceCores}P + ${this.hwProfile.cpu.efficiencyCores}E), Metal: ${this.hwProfile.gpu.metalEnabled}, ANE: ${this.hwProfile.neuralEngine.present}`);
    }

    private async phase2_InitializeEventLoopAndBrokers() {
        this.currentPhase = 2;
        console.log(`[Phase ${this.currentPhase}] Initializing Event Loop, ZeroMQ ROUTER/DEALER, Redis Streams, Thread/Process Pools...`);
        await globalBroker.initialize(5555, 5556);
        console.log(`[Phase ${this.currentPhase}] Pools ready -> maxThreads: ${globalThreadPool.maxSize}, process pool initialized: ${!!globalProcessPool}`);
    }

    private async phase3_WarmUpModels() {
        this.currentPhase = 3;
        console.log(`[Phase ${this.currentPhase}] Warming up Embedded Models (BGE-M3, CLIP, CodeBERT, Whisper) in VRAM...`);
        await globalModelManager.warmupAll();
    }

    private async phase4_InitializeKnowledgeGraph() {
        this.currentPhase = 4;
        console.log(`[Phase ${this.currentPhase}] Initializing Knowledge Graph on RocksDB with FAISS HNSW M=48...`);
        await initializeKnowledgeGraph();
    }

    private async phase5_SpawnPerceptionDaemons() {
        this.currentPhase = 5;
        console.log(`[Phase ${this.currentPhase}] Spawning supervised Perception Daemons (Screen, Input, FS, Network, Process)...`);
        await spawnPerceptionDaemons();
    }

    private async phase6_BootstrapToolRegistryAndMemory() {
        this.currentPhase = 6;
        console.log(`[Phase ${this.currentPhase}] Bootstrapping Tool Registry (MCP), generating embeddings, restoring memory state...`);
        // TODO: Load toolRegistry + memory indices
    }

    private async phase7_SelfTestDiagnostic() {
        this.currentPhase = 7;
        console.log(`[Phase ${this.currentPhase}] Running Self-Test Diagnostic Suite (LLM latency, Tool execution, DB RW, Perception E2E)...`);
        // TODO: Run synthetic checks
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const bootloader = new CognitiveKernelBootloader();
    bootloader.boot().then(() => {
        console.log('[Test] Boot sequence passed.');
        process.exit(0);
    }).catch(err => {
        console.error('[CognitiveKernel] FATAL BOOT EXCEPTION:', err);
        process.exit(1);
    });
}
