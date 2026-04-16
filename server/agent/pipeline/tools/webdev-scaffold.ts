import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

function getSandboxPath(runId: string): string {
  return `/tmp/agent-${runId}`;
}

function ensureSandbox(runId: string): string {
  const sandboxPath = getSandboxPath(runId);
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}

function writeFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = path.join(basePath, relativePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, "utf-8");
}

interface ScaffoldTemplate {
  files: Record<string, string>;
  directories: string[];
}

const REACT_TEMPLATE: ScaffoldTemplate = {
  directories: ["src", "src/components", "src/hooks", "src/styles", "public"],
  files: {
    "package.json": JSON.stringify({
      name: "react-app",
      version: "1.0.0",
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.0.0",
        vite: "^5.0.0"
      }
    }, null, 2),
    "vite.config.js": `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5000, host: '0.0.0.0' }
})`,
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`,
    "src/main.jsx": `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`,
    "src/App.jsx": `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <h1>React App</h1>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  )
}

export default App`,
    "src/styles/index.css": `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; }
.app { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 1rem; }`
  }
};

const VUE_TEMPLATE: ScaffoldTemplate = {
  directories: ["src", "src/components", "src/assets", "public"],
  files: {
    "package.json": JSON.stringify({
      name: "vue-app",
      version: "1.0.0",
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        vue: "^3.4.0"
      },
      devDependencies: {
        "@vitejs/plugin-vue": "^5.0.0",
        vite: "^5.0.0"
      }
    }, null, 2),
    "vite.config.js": `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: { port: 5000, host: '0.0.0.0' }
})`,
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vue App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`,
    "src/main.js": `import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

createApp(App).mount('#app')`,
    "src/App.vue": `<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <div class="app">
    <h1>Vue App</h1>
    <button @click="count++">Count: {{ count }}</button>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 1rem; }
</style>`,
    "src/assets/main.css": `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; }`
  }
};

const NEXTJS_TEMPLATE: ScaffoldTemplate = {
  directories: ["app", "components", "public", "styles"],
  files: {
    "package.json": JSON.stringify({
      name: "nextjs-app",
      version: "1.0.0",
      private: true,
      scripts: {
        dev: "next dev -p 5000",
        build: "next build",
        start: "next start -p 5000"
      },
      dependencies: {
        next: "^14.0.0",
        react: "^18.2.0",
        "react-dom": "^18.2.0"
      }
    }, null, 2),
    "next.config.js": `/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true }`,
    "app/layout.jsx": `import '../styles/globals.css'

export const metadata = { title: 'Next.js App', description: 'Generated by scaffold' }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}`,
    "app/page.jsx": `'use client'
import { useState } from 'react'

export default function Home() {
  const [count, setCount] = useState(0)
  return (
    <main className="main">
      <h1>Next.js App</h1>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
    </main>
  )
}`,
    "styles/globals.css": `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; }
.main { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 1rem; }`
  }
};

const EXPRESS_TEMPLATE: ScaffoldTemplate = {
  directories: ["src", "src/routes", "src/middleware", "src/controllers"],
  files: {
    "package.json": JSON.stringify({
      name: "express-api",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        dev: "node --watch src/index.js",
        start: "node src/index.js"
      },
      dependencies: {
        express: "^4.18.0",
        cors: "^2.8.5",
        helmet: "^7.0.0"
      }
    }, null, 2),
    "src/index.js": `import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { router } from './routes/index.js'

const app = express()
const PORT = process.env.PORT || 5000

app.use(helmet())
app.use(cors())
app.use(express.json())

app.use('/api', router)

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server running on port \${PORT}\`)
})`,
    "src/routes/index.js": `import { Router } from 'express'
import { getItems, createItem } from '../controllers/items.js'

export const router = Router()

router.get('/items', getItems)
router.post('/items', createItem)`,
    "src/controllers/items.js": `const items = []

export const getItems = (req, res) => {
  res.json(items)
}

export const createItem = (req, res) => {
  const item = { id: Date.now(), ...req.body }
  items.push(item)
  res.status(201).json(item)
}`,
    "src/middleware/auth.js": `export const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}`
  }
};

const FASTAPI_TEMPLATE: ScaffoldTemplate = {
  directories: ["app", "app/routers", "app/models", "app/schemas"],
  files: {
    "requirements.txt": `fastapi>=0.128.0
uvicorn[standard]>=0.40.0
pydantic>=2.0.0
python-multipart>=0.0.22`,
    "app/__init__.py": "",
    "app/main.py": `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import items

app = FastAPI(title="FastAPI App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(items.router, prefix="/api")

@app.get("/health")
async def health():
    return {"status": "ok"}`,
    "app/routers/__init__.py": "",
    "app/routers/items.py": `from fastapi import APIRouter, HTTPException
from app.schemas.item import Item, ItemCreate

router = APIRouter()
items_db: list[Item] = []

@router.get("/items", response_model=list[Item])
async def get_items():
    return items_db

@router.post("/items", response_model=Item)
async def create_item(item: ItemCreate):
    new_item = Item(id=len(items_db) + 1, **item.model_dump())
    items_db.append(new_item)
    return new_item`,
    "app/schemas/__init__.py": "",
    "app/schemas/item.py": `from pydantic import BaseModel

class ItemBase(BaseModel):
    name: str
    description: str | None = None

class ItemCreate(ItemBase):
    pass

class Item(ItemBase):
    id: int`,
    "run.py": `import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=5000, reload=True)`
  }
};

const TEMPLATES: Record<string, ScaffoldTemplate> = {
  init_react: REACT_TEMPLATE,
  init_vue: VUE_TEMPLATE,
  init_nextjs: NEXTJS_TEMPLATE,
  init_express: EXPRESS_TEMPLATE,
  init_fastapi: FASTAPI_TEMPLATE
};

export const webdevScaffoldTool: ToolDefinition = {
  id: "webdev_scaffold",
  name: "Web Dev Scaffold",
  description: "Generate project scaffolding for web development frameworks (React, Vue, Next.js, Express, FastAPI)",
  category: "file",
  capabilities: ["scaffold", "init", "project", "react", "vue", "nextjs", "express", "fastapi", "boilerplate"],
  inputSchema: {
    action: {
      type: "string",
      description: "The framework to scaffold",
      enum: ["init_react", "init_vue", "init_nextjs", "init_express", "init_fastapi"],
      required: true
    },
    projectName: {
      type: "string",
      description: "Name of the project",
      default: "my-app"
    },
    targetDir: {
      type: "string",
      description: "Target directory within sandbox",
      default: ""
    }
  },
  outputSchema: {
    projectPath: { type: "string", description: "Path to created project" },
    files: { type: "array", description: "List of created files" },
    framework: { type: "string", description: "Framework used" }
  },

  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { action, projectName = "my-app", targetDir = "" } = params;

    const template = TEMPLATES[action];
    if (!template) {
      return { success: false, error: `Unknown action: ${action}` };
    }

    try {
      const sandboxPath = ensureSandbox(context.runId);
      const projectPath = path.join(sandboxPath, targetDir, projectName);

      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }

      for (const dir of template.directories) {
        const dirPath = path.join(projectPath, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      }

      const createdFiles: string[] = [];
      const artifacts: Artifact[] = [];

      for (const [filePath, content] of Object.entries(template.files)) {
        writeFile(projectPath, filePath, content);
        createdFiles.push(filePath);

        if (filePath === "package.json" || filePath === "requirements.txt") {
          artifacts.push({
            id: crypto.randomUUID(),
            type: "json",
            name: filePath,
            content,
            size: content.length,
            metadata: { framework: action }
          });
        }
      }

      const framework = action.replace("init_", "");

      return {
        success: true,
        data: {
          projectPath: path.relative(sandboxPath, projectPath),
          files: createdFiles,
          directories: template.directories,
          framework
        },
        artifacts,
        metadata: {
          framework,
          fileCount: createdFiles.length,
          directoryCount: template.directories.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
