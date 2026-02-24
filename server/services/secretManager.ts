import { env } from "../config/env";
import crypto from "crypto";

export class SecretManager {
    /**
     * T100-3.1: Zero-Secrets Policy Enforcer.
     * Solo permite obtener un secreto si está explícitamente solicitado,
     * evitando que todo el `process.env` se vuelque en logs por accidente.
     */

    private readonly encryptionKey: string;

    constructor() {
        // Usa una llave de cifrado de KMS / Vault (mocked to env for now)
        this.encryptionKey = env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    }

    /**
     * Recupera una API Key de forma temporal en memoria. 
     * Nunca debe asignarse a objetos globales o logs.
     */
    getLLMProviderKey(provider: 'openai' | 'anthropic' | 'gemini' | 'xai' | 'deepseek'): string {
        switch (provider) {
            case 'openai':
                return this.requireSecret(env.OPENAI_API_KEY, "OPENAI_API_KEY");
            case 'anthropic':
                return this.requireSecret(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY");
            case 'gemini':
                return this.requireSecret(env.GEMINI_API_KEY || env.GOOGLE_API_KEY, "GEMINI_API_KEY");
            case 'xai':
                return this.requireSecret(env.XAI_API_KEY, "XAI_API_KEY");
            case 'deepseek':
                return this.requireSecret(env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY");
            default:
                throw new Error(`[SecretManager] Proveedor no autorizado: ${provider}`);
        }
    }

    /**
     * Valida la existencia de la llave y lanza error catastrófico (Fail-Fast)
     * si no existe, previniendo fallas silenciosas en producción.
     */
    private requireSecret(secretValue: string | undefined, secretName: string): string {
        if (!secretValue || secretValue.trim() === '') {
            throw new Error(`[SecretManager] Critical Security Fault: Missing Secret [${secretName}]. System Halting.`);
        }
        return secretValue;
    }

    /**
     * Mask un secreto para auditorías MUTEABLES (Logging RED)
     * Ej: sk-1234567890 -> sk-12...890
     */
    maskSecret(secret: string): string {
        if (!secret) return "";
        if (secret.length < 8) return "***";
        return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
    }
}

export const secretManager = new SecretManager();
