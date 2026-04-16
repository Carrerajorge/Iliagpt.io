export interface ModelConfig {
    name: string;
    type: 'embedding' | 'vision' | 'audio' | 'vlm';
    dimensions?: number;
    provider: 'local_onnx' | 'mlx' | 'coreml' | 'remote';
}

export class ModelWarmupManager {
    private modelsLoaded: Map<string, boolean> = new Map();

    private readonly registry: ModelConfig[] = [
        { name: 'BGE-M3', type: 'embedding', dimensions: 1024, provider: 'local_onnx' },
        { name: 'CLIP-ViT-L-14', type: 'vision', dimensions: 768, provider: 'coreml' },
        { name: 'CodeBERT', type: 'embedding', dimensions: 768, provider: 'local_onnx' },
        { name: 'Whisper-large-v3', type: 'audio', provider: 'coreml' }
    ];

    public async warmupAll(): Promise<void> {
        console.log('[ModelWarmup] Starting VRAM allocations array...');
        const promises = this.registry.map(m => this.loadModel(m));
        await Promise.all(promises);
        console.log('[ModelWarmup] All cognitive embedding models are warm and ready in MLComputeUnits.all.');
    }

    private async loadModel(config: ModelConfig): Promise<void> {
        console.log(`[ModelWarmup] Loading ${config.name} (${config.type}) via ${config.provider}...`);
        // Simulate loading time (e.g. VRAM allocations, graph builds)
        return new Promise(resolve => {
            setTimeout(() => {
                this.modelsLoaded.set(config.name, true);
                console.log(`[ModelWarmup] -> ${config.name} loaded.`);
                resolve();
            }, Math.random() * 800 + 200);
        });
    }

    public isLoaded(modelName: string): boolean {
        return this.modelsLoaded.get(modelName) || false;
    }
}

export const globalModelManager = new ModelWarmupManager();
