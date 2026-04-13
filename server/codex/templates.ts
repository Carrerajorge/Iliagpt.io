/**
 * Codex VC — Project templates for quick-start scaffolding.
 */

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  framework: string;
  language: string;
  icon: string;
  files: Record<string, string>;
}

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "react-ts-tailwind",
    name: "React + TypeScript + Tailwind",
    description: "Modern React app with TypeScript and Tailwind CSS",
    framework: "react",
    language: "typescript",
    icon: "⚛️",
    files: {
      "package.json": JSON.stringify({
        name: "my-app",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: {
          "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^4.3.0", typescript: "^5.6.0",
          vite: "^6.0.0", tailwindcss: "^4.0.0", "@tailwindcss/vite": "^4.0.0",
        },
      }, null, 2),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2020", useDefineForClassFields: true, lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext", skipLibCheck: true, moduleResolution: "bundler",
          allowImportingTsExtensions: true, isolatedModules: true, noEmit: true, jsx: "react-jsx",
          strict: true, noUnusedLocals: true, noUnusedParameters: true, noFallthroughCasesInSwitch: true,
        },
        include: ["src"],
      }, null, 2),
      "vite.config.ts": `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n})\n`,
      "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>My App</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n`,
      "src/main.tsx": `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n)\n`,
      "src/App.tsx": `export default function App() {\n  return (\n    <div className="min-h-screen bg-gray-50 flex items-center justify-center">\n      <div className="text-center">\n        <h1 className="text-4xl font-bold text-gray-900 mb-4">Welcome</h1>\n        <p className="text-gray-600">Edit src/App.tsx to get started</p>\n      </div>\n    </div>\n  )\n}\n`,
      "src/index.css": `@import "tailwindcss";\n`,
    },
  },
  {
    id: "express-ts-api",
    name: "Express API + TypeScript",
    description: "REST API with Express and TypeScript",
    framework: "express",
    language: "typescript",
    icon: "🚀",
    files: {
      "package.json": JSON.stringify({
        name: "api-server",
        version: "1.0.0",
        type: "module",
        scripts: { dev: "tsx watch src/index.ts", build: "tsc", start: "node dist/index.js" },
        dependencies: { express: "^5.0.0", cors: "^2.8.5" },
        devDependencies: { "@types/express": "^5.0.0", "@types/cors": "^2.8.0", tsx: "^4.0.0", typescript: "^5.6.0" },
      }, null, 2),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
          outDir: "./dist", strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ["src"],
      }, null, 2),
      "src/index.ts": `import express from 'express';\nimport cors from 'cors';\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get('/api/health', (_req, res) => {\n  res.json({ status: 'ok', timestamp: new Date().toISOString() });\n});\n\napp.get('/api/items', (_req, res) => {\n  res.json([{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]);\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on http://localhost:\${PORT}\`);\n});\n`,
    },
  },
  {
    id: "nextjs-prisma",
    name: "Next.js + Prisma + PostgreSQL",
    description: "Full-stack Next.js with Prisma ORM",
    framework: "nextjs",
    language: "typescript",
    icon: "▲",
    files: {
      "package.json": JSON.stringify({
        name: "nextjs-app",
        version: "0.1.0",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0", "@prisma/client": "^6.0.0" },
        devDependencies: { typescript: "^5.6.0", "@types/react": "^19.0.0", prisma: "^6.0.0" },
      }, null, 2),
      "src/app/page.tsx": `export default function Home() {\n  return (\n    <main className="flex min-h-screen flex-col items-center justify-center p-24">\n      <h1 className="text-4xl font-bold">Welcome to Next.js</h1>\n    </main>\n  )\n}\n`,
      "src/app/layout.tsx": `export const metadata = { title: 'My App', description: 'Built with Next.js' }\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  )\n}\n`,
    },
  },
  {
    id: "landing-page",
    name: "Landing Page HTML/CSS",
    description: "Simple landing page with modern design",
    framework: "html",
    language: "html",
    icon: "🌐",
    files: {
      "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Landing Page</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <header>\n    <nav><a href="#" class="logo">Brand</a></nav>\n  </header>\n  <main>\n    <section class="hero">\n      <h1>Build Something Amazing</h1>\n      <p>Start your project today with our powerful tools.</p>\n      <a href="#" class="cta">Get Started</a>\n    </section>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
      "style.css": `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }\n.hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; }\n.hero h1 { font-size: 3.5rem; margin-bottom: 1rem; }\n.hero p { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }\n.cta { display: inline-block; padding: 1rem 2.5rem; background: white; color: #667eea; border-radius: 50px; text-decoration: none; font-weight: 600; transition: transform 0.2s; }\n.cta:hover { transform: translateY(-2px); }\nnav { position: fixed; top: 0; width: 100%; padding: 1.5rem 2rem; }\n.logo { color: white; text-decoration: none; font-size: 1.5rem; font-weight: 700; }\n`,
      "script.js": `document.addEventListener('DOMContentLoaded', () => {\n  console.log('Landing page loaded');\n});\n`,
    },
  },
  {
    id: "python-flask",
    name: "Python Flask API",
    description: "REST API with Python Flask",
    framework: "flask",
    language: "python",
    icon: "🐍",
    files: {
      "requirements.txt": "flask>=3.0.0\nflask-cors>=4.0.0\ngunicorn>=22.0.0\n",
      "app.py": `from flask import Flask, jsonify, request\nfrom flask_cors import CORS\n\napp = Flask(__name__)\nCORS(app)\n\nitems = [\n    {"id": 1, "name": "Item 1"},\n    {"id": 2, "name": "Item 2"},\n]\n\n@app.route("/api/health")\ndef health():\n    return jsonify({"status": "ok"})\n\n@app.route("/api/items")\ndef get_items():\n    return jsonify(items)\n\n@app.route("/api/items", methods=["POST"])\ndef create_item():\n    item = request.get_json()\n    item["id"] = len(items) + 1\n    items.append(item)\n    return jsonify(item), 201\n\nif __name__ == "__main__":\n    app.run(debug=True, port=3000)\n`,
    },
  },
  {
    id: "vue3-vite",
    name: "Vue 3 + Vite",
    description: "Vue 3 SPA with Vite and TypeScript",
    framework: "vue",
    language: "typescript",
    icon: "💚",
    files: {
      "package.json": JSON.stringify({
        name: "vue-app",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "vue-tsc && vite build", preview: "vite preview" },
        dependencies: { vue: "^3.5.0" },
        devDependencies: {
          "@vitejs/plugin-vue": "^5.0.0", typescript: "^5.6.0",
          vite: "^6.0.0", "vue-tsc": "^2.0.0",
        },
      }, null, 2),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2020", module: "ESNext", moduleResolution: "bundler",
          strict: true, jsx: "preserve", skipLibCheck: true, noEmit: true,
        },
        include: ["src/**/*.ts", "src/**/*.vue"],
      }, null, 2),
      "vite.config.ts": `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n\nexport default defineConfig({\n  plugins: [vue()],\n})\n`,
      "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vue App</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`,
      "src/main.ts": `import { createApp } from 'vue'\nimport App from './App.vue'\n\ncreateApp(App).mount('#app')\n`,
      "src/App.vue": `<script setup lang="ts">\nimport { ref } from 'vue'\nconst count = ref(0)\n</script>\n\n<template>\n  <div style="text-align: center; padding: 2rem">\n    <h1>Welcome to Vue 3</h1>\n    <button @click="count++">Count is: {{ count }}</button>\n  </div>\n</template>\n`,
    },
  },
  {
    id: "cli-nodejs",
    name: "CLI Tool Node.js",
    description: "Command-line tool with Node.js",
    framework: "node",
    language: "typescript",
    icon: "⌨️",
    files: {
      "package.json": JSON.stringify({
        name: "my-cli",
        version: "1.0.0",
        type: "module",
        bin: { "my-cli": "./dist/index.js" },
        scripts: { dev: "tsx src/index.ts", build: "tsc", start: "node dist/index.js" },
        dependencies: {},
        devDependencies: { tsx: "^4.0.0", typescript: "^5.6.0" },
      }, null, 2),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", strict: true },
        include: ["src"],
      }, null, 2),
      "src/index.ts": `#!/usr/bin/env node\n\nconst args = process.argv.slice(2);\nconst command = args[0];\n\nswitch (command) {\n  case 'hello':\n    console.log('Hello, World!');\n    break;\n  case 'help':\n    console.log('Usage: my-cli <command>');\n    console.log('Commands: hello, help');\n    break;\n  default:\n    console.log('Unknown command. Run "my-cli help" for usage.');\n}\n`,
    },
  },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function listTemplates(): Array<{ id: string; name: string; description: string; icon: string; framework: string }> {
  return TEMPLATES.map(({ id, name, description, icon, framework }) => ({ id, name, description, icon, framework }));
}
