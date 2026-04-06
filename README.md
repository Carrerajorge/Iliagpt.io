# IliaGPT

Plataforma full-stack (React + Vite, Express, PostgreSQL) para chat asistido por LLM, agentes con herramientas, RAG, integración OpenClaw y más. Resumen técnico ampliado: ver [`replit.md`](./replit.md).

## Requisitos

- Node.js 20+ (recomendado alinear con el runtime de producción)
- PostgreSQL
- Redis (rate limiting, colas y memoria según configuración)

## Configuración

1. Copia variables de entorno: `DATABASE_URL`, `SESSION_SECRET`, claves de al menos un proveedor LLM, etc. (validación en `server/config/env.ts`).
2. Base de datos: `npm run db:bootstrap` (extensiones + migraciones Drizzle).

## Comandos

| Comando | Descripción |
|--------|-------------|
| `npm run dev` | Servidor API (puerto por defecto desde `PORT`) |
| `npm run dev:client` | Frontend Vite (puerto 5000) |
| `npm run build` / `npm start` | Build y arranque en producción |
| `npm run test:run` | Vitest |
| `npm run test:e2e` | Playwright |

## Variables destacadas

- **`WEB_RETRIEVAL_PIPELINE`**: `fast_first` | `legacy`. Por defecto: `fast_first` en producción y `legacy` en desarrollo/test. El modo rápido solo se usa si el usuario tiene permitido el acceso al navegador remoto en privacidad y no solicita Scholar ni `preferBrowser`; en caso contrario se usa el pipeline clásico (comportamiento correcto y seguro).

## Madurez por áreas

- **Estable / uso diario**: chat, autenticación, límites, WebTool con pipelines probados, tests PARE/agentic, observabilidad (métricas/trazas según despliegue).
- **Experimental / bajo banderas**: partes descritas como experimentales en `replit.md` (por ejemplo orquestadores avanzados); revisar flags y documentación interna antes de exponer en producción.
