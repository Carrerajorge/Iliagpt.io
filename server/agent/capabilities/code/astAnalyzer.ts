import { z } from 'zod';
import { AgentCapability } from '../registry';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export const astAnalyzerCapability: AgentCapability = {
    name: "analyze_typescript_ast",
    description: "Parsea un archivo TypeScript/JavaScript y extrae su Árbol de Sintaxis Abstracta (AST) de forma resumida para el agente. Ideal para entender la arquitectura de un archivo sin consumir miles de tokens leyendo su texto plano.",
    schema: z.object({
        filePath: z.string().describe("Ruta absoluta o relativa del archivo TypeScript a analizar.")
    }),
    execute: async ({ filePath }) => {
        try {
            const targetPath = path.resolve(process.cwd(), filePath);

            if (!fs.existsSync(targetPath)) {
                return { error: `File not found: ${targetPath}` };
            }

            const sourceCode = fs.readFileSync(targetPath, 'utf8');

            // Creamos el nodo raíz SourceFile
            const sourceFile = ts.createSourceFile(
                path.basename(targetPath),
                sourceCode,
                ts.ScriptTarget.Latest,
                true
            );

            const functions: string[] = [];
            const classes: string[] = [];
            const interfaces: string[] = [];

            // Walk interactivo por el AST extraíendo solo las top-level declarations
            ts.forEachChild(sourceFile, (node) => {
                if (ts.isFunctionDeclaration(node) && node.name) {
                    functions.push(node.name.text);
                } else if (ts.isClassDeclaration(node) && node.name) {
                    classes.push(node.name.text);
                } else if (ts.isInterfaceDeclaration(node) && node.name) {
                    interfaces.push(node.name.text);
                }
            });

            return {
                analyzed_file: path.basename(targetPath),
                total_lines_approx: sourceCode.split('\n').length,
                discovered_functions: functions,
                discovered_classes: classes,
                discovered_interfaces: interfaces,
                success: true
            };

        } catch (error: any) {
            console.error("[Code Submodule AST Error]", error.message);
            return { error: `AST parser failed. Reason: ${error.message}` };
        }
    }
};
