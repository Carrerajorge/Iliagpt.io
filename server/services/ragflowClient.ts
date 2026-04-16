// Import the vendored OpenClaw source directly so the server bundle includes the
// native integration instead of depending on a packaged @hola/openclaw runtime.
import { createDefaultDeps } from "../openclaw/src/cli/deps.js";
import fs from "fs/promises";
import { OPENCLAW_RELEASE_VERSION } from "@shared/openclawRelease";

export interface CreateDatasetRequest {
    name: string;
    description?: string;
}

export interface DocumentUploadResponse {
    doc_id: string;
    name: string;
    status: string;
}

export interface RAGChatRequest {
    messages: Array<{ role: "user" | "assistant" | "system", content: string }>;
    dataset_ids: string[];
}

export class RagflowNativeClient {
    private engineDeps: any = null;

    constructor() {
        this.initEngine();
    }

    private async initEngine() {
        if (!this.engineDeps) {
            console.log("[OpenClaw Native] Initializing context-engine...");
            this.engineDeps = await createDefaultDeps();
        }
        return this.engineDeps;
    }

    async createDataset(request: CreateDatasetRequest) {
        await this.initEngine();
        // Native dataset creation logic mock/fusion
        const datasetId = `native-ds-${Date.now()}`;
        return {
            dataset_id: datasetId,
            name: request.name,
            status: "created (native)"
        };
    }

    async uploadDocument(datasetId: string, fileBuffer: Buffer | ArrayBuffer, fileName: string): Promise<DocumentUploadResponse> {
        await this.initEngine();
        // Here we would feed the document into the native vector store.
        console.log(`[OpenClaw Native] Ingesting document ${fileName} into dataset ${datasetId}`);
        return {
            doc_id: `native-doc-${Date.now()}`,
            name: fileName,
            status: "indexed (native)"
        };
    }

    async chat(request: RAGChatRequest) {
        await this.initEngine();
        const lastMessage = request.messages[request.messages.length - 1]?.content || "";
        const combinedInput = `[CONTEXT: Datasets ${request.dataset_ids.join(",")}] \n\n[INSTRUCTION]: ${lastMessage}`;
        
        return {
            response: `Simulated RAG output natively executing OpenClaw v${OPENCLAW_RELEASE_VERSION} logic: Entendido. La instrucción es: "${lastMessage}"`
        };
    }

    async searchKnowledgeBase(query: string, datasetIds: string[]) {
        await this.initEngine();
        return {
            results: [
                { content: `[Native Search Result] Simulated relevant context for query: "${query}" from native OpenClaw memory.` }
            ]
        };
    }
}

// Singleton export leveraging native execution
export const ragflowClient = new RagflowNativeClient();
