import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as mime from "mime-types";
import { FileInfo, FileOperationResult, FileManagerStats } from "./types";
import { SecurityGuard } from "./securityGuard";

export class FileManager {
  private sandboxRoot: string;
  private security: SecurityGuard;
  private maxFileSize: number;
  private stats = {
    filesRead: 0,
    filesWritten: 0,
    filesDeleted: 0,
    bytesRead: 0,
    bytesWritten: 0,
  };

  constructor(sandboxRoot?: string, securityGuard?: SecurityGuard, maxFileSize: number = 100 * 1024 * 1024) {
    this.sandboxRoot = sandboxRoot || path.join(process.cwd(), "sandbox_workspace");
    this.security = securityGuard ?? new SecurityGuard(this.sandboxRoot);
    this.maxFileSize = maxFileSize;

    if (!fs.existsSync(this.sandboxRoot)) {
      fs.mkdirSync(this.sandboxRoot, { recursive: true });
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }
    return path.resolve(this.sandboxRoot, filePath);
  }

  private validatePath(filePath: string): { isAllowed: boolean; resolvedPath: string; reason: string } {
    const result = this.security.validatePath(filePath);
    return {
      isAllowed: result.isAllowed,
      resolvedPath: result.resolvedPath || this.resolvePath(filePath),
      reason: result.reason,
    };
  }

  async read(filePath: string, encoding: BufferEncoding = "utf-8"): Promise<FileOperationResult> {
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return { success: false, operation: "read", path: filePath, error: validation.reason };
    }

    try {
      const content = await fsp.readFile(validation.resolvedPath, { encoding });
      this.stats.filesRead++;
      this.stats.bytesRead += content.length;
      return {
        success: true,
        operation: "read",
        path: validation.resolvedPath,
        data: content,
        message: `Archivo leído: ${content.length} bytes`,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: false, operation: "read", path: filePath, error: "Archivo no encontrado" };
      }
      return { success: false, operation: "read", path: filePath, error: String(error) };
    }
  }

  async write(
    filePath: string,
    content: string,
    options: { encoding?: BufferEncoding; createDirs?: boolean } = {}
  ): Promise<FileOperationResult> {
    const { encoding = "utf-8", createDirs = true } = options;
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return { success: false, operation: "write", path: filePath, error: validation.reason };
    }

    const contentSize = Buffer.byteLength(content, encoding);
    if (contentSize > this.maxFileSize) {
      return { success: false, operation: "write", path: filePath, error: "Archivo excede el tamaño máximo" };
    }

    try {
      if (createDirs) {
        const dir = path.dirname(validation.resolvedPath);
        await fsp.mkdir(dir, { recursive: true });
      }
      await fsp.writeFile(validation.resolvedPath, content, { encoding });
      this.stats.filesWritten++;
      this.stats.bytesWritten += contentSize;
      return {
        success: true,
        operation: "write",
        path: validation.resolvedPath,
        message: `Archivo escrito: ${contentSize} bytes`,
      };
    } catch (error) {
      return { success: false, operation: "write", path: filePath, error: String(error) };
    }
  }

  async append(filePath: string, content: string, encoding: BufferEncoding = "utf-8"): Promise<FileOperationResult> {
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return { success: false, operation: "append", path: filePath, error: validation.reason };
    }

    try {
      await fsp.appendFile(validation.resolvedPath, content, { encoding });
      return {
        success: true,
        operation: "append",
        path: validation.resolvedPath,
        message: `Contenido añadido: ${content.length} bytes`,
      };
    } catch (error) {
      return { success: false, operation: "append", path: filePath, error: String(error) };
    }
  }

  async delete(filePath: string, recursive: boolean = false): Promise<FileOperationResult> {
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return { success: false, operation: "delete", path: filePath, error: validation.reason };
    }

    try {
      const stat = await fsp.stat(validation.resolvedPath);
      if (stat.isFile()) {
        await fsp.unlink(validation.resolvedPath);
      } else if (stat.isDirectory()) {
        if (recursive) {
          await fsp.rm(validation.resolvedPath, { recursive: true, force: true });
        } else {
          await fsp.rmdir(validation.resolvedPath);
        }
      }
      this.stats.filesDeleted++;
      return { success: true, operation: "delete", path: validation.resolvedPath, message: "Eliminado correctamente" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: false, operation: "delete", path: filePath, error: "Archivo o directorio no existe" };
      }
      return { success: false, operation: "delete", path: filePath, error: String(error) };
    }
  }

  async mkdir(dirPath: string, parents: boolean = true): Promise<FileOperationResult> {
    const validation = this.validatePath(dirPath);
    if (!validation.isAllowed) {
      return { success: false, operation: "mkdir", path: dirPath, error: validation.reason };
    }

    try {
      await fsp.mkdir(validation.resolvedPath, { recursive: parents });
      return { success: true, operation: "mkdir", path: validation.resolvedPath, message: "Directorio creado" };
    } catch (error) {
      return { success: false, operation: "mkdir", path: dirPath, error: String(error) };
    }
  }

  async listDir(
    dirPath: string = ".",
    pattern?: string,
    recursive: boolean = false
  ): Promise<FileOperationResult> {
    const validation = this.validatePath(dirPath);
    if (!validation.isAllowed) {
      return { success: false, operation: "list_dir", path: dirPath, error: validation.reason };
    }

    try {
      const items: FileInfo[] = [];
      const files = await this.listFilesRecursive(validation.resolvedPath, recursive, pattern);

      for (const file of files) {
        const info = await this.getFileInfo(file);
        if (info) {
          items.push(info);
        }
      }

      return {
        success: true,
        operation: "list_dir",
        path: validation.resolvedPath,
        data: { items, count: items.length, pattern },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: false, operation: "list_dir", path: dirPath, error: "Directorio no existe" };
      }
      return { success: false, operation: "list_dir", path: dirPath, error: String(error) };
    }
  }

  private async listFilesRecursive(dir: string, recursive: boolean, pattern?: string): Promise<string[]> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);
      const matchesPattern = !pattern || this.matchGlob(entry.name, pattern);

      if (entry.isFile() && matchesPattern) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        if (matchesPattern) {
          files.push(fullPath);
        }
        if (recursive) {
          const subFiles = await this.listFilesRecursive(fullPath, true, pattern);
          files.push(...subFiles);
        }
      }
    }

    return files;
  }

  private matchGlob(name: string, pattern: string): boolean {
    if (pattern === "*") return true;
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return regex.test(name);
  }

  async exists(filePath: string): Promise<FileOperationResult> {
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return {
        success: true,
        operation: "exists",
        path: filePath,
        data: { exists: false },
        message: "Ruta fuera del sandbox",
      };
    }

    try {
      const stat = await fsp.stat(validation.resolvedPath);
      return {
        success: true,
        operation: "exists",
        path: validation.resolvedPath,
        data: { exists: true, isFile: stat.isFile(), isDir: stat.isDirectory() },
      };
    } catch {
      return {
        success: true,
        operation: "exists",
        path: validation.resolvedPath,
        data: { exists: false, isFile: false, isDir: false },
      };
    }
  }

  async getInfo(filePath: string): Promise<FileOperationResult> {
    const validation = this.validatePath(filePath);
    if (!validation.isAllowed) {
      return { success: false, operation: "get_info", path: filePath, error: validation.reason };
    }

    try {
      const info = await this.getFileInfo(validation.resolvedPath);
      if (!info) {
        return { success: false, operation: "get_info", path: filePath, error: "Archivo no existe" };
      }
      return { success: true, operation: "get_info", path: validation.resolvedPath, data: info };
    } catch (error) {
      return { success: false, operation: "get_info", path: filePath, error: String(error) };
    }
  }

  private async getFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const stat = await fsp.stat(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        extension: path.extname(filePath),
        size: stat.size,
        isFile: stat.isFile(),
        isDir: stat.isDirectory(),
        created: stat.birthtime,
        modified: stat.mtime,
        permissions: (stat.mode & 0o777).toString(8).padStart(3, "0"),
        mimeType: mime.lookup(filePath) || null,
      };
    } catch {
      return null;
    }
  }

  async copy(src: string, dst: string): Promise<FileOperationResult> {
    const srcValidation = this.validatePath(src);
    const dstValidation = this.validatePath(dst);

    if (!srcValidation.isAllowed || !dstValidation.isAllowed) {
      return { success: false, operation: "copy", path: src, error: "Ruta origen o destino no permitida" };
    }

    try {
      const stat = await fsp.stat(srcValidation.resolvedPath);
      const dstDir = path.dirname(dstValidation.resolvedPath);
      await fsp.mkdir(dstDir, { recursive: true });

      if (stat.isFile()) {
        await fsp.copyFile(srcValidation.resolvedPath, dstValidation.resolvedPath);
      } else {
        await this.copyDir(srcValidation.resolvedPath, dstValidation.resolvedPath);
      }
      return {
        success: true,
        operation: "copy",
        path: dstValidation.resolvedPath,
        message: `Copiado de ${src} a ${dst}`,
      };
    } catch (error) {
      return { success: false, operation: "copy", path: src, error: String(error) };
    }
  }

  private async copyDir(src: string, dst: string): Promise<void> {
    await fsp.mkdir(dst, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, dstPath);
      } else {
        await fsp.copyFile(srcPath, dstPath);
      }
    }
  }

  async move(src: string, dst: string): Promise<FileOperationResult> {
    const srcValidation = this.validatePath(src);
    const dstValidation = this.validatePath(dst);

    if (!srcValidation.isAllowed || !dstValidation.isAllowed) {
      return { success: false, operation: "move", path: src, error: "Ruta origen o destino no permitida" };
    }

    try {
      const dstDir = path.dirname(dstValidation.resolvedPath);
      await fsp.mkdir(dstDir, { recursive: true });
      await fsp.rename(srcValidation.resolvedPath, dstValidation.resolvedPath);
      return {
        success: true,
        operation: "move",
        path: dstValidation.resolvedPath,
        message: `Movido de ${src} a ${dst}`,
      };
    } catch (error) {
      return { success: false, operation: "move", path: src, error: String(error) };
    }
  }

  async readJson<T = unknown>(filePath: string): Promise<FileOperationResult> {
    const result = await this.read(filePath);
    if (!result.success) return result;

    try {
      const data = JSON.parse(result.data as string) as T;
      return { success: true, operation: "read_json", path: filePath, data };
    } catch (error) {
      return { success: false, operation: "read_json", path: filePath, error: `Error parsing JSON: ${error}` };
    }
  }

  async writeJson(filePath: string, data: unknown, indent: number = 2): Promise<FileOperationResult> {
    try {
      const content = JSON.stringify(data, null, indent);
      return await this.write(filePath, content);
    } catch (error) {
      return { success: false, operation: "write_json", path: filePath, error: `Error serializando JSON: ${error}` };
    }
  }

  async search(
    pattern: string,
    dirPath: string = ".",
    contentSearch?: string,
    maxResults: number = 100
  ): Promise<FileOperationResult> {
    const validation = this.validatePath(dirPath);
    if (!validation.isAllowed) {
      return { success: false, operation: "search", path: dirPath, error: validation.reason };
    }

    try {
      const results: FileInfo[] = [];
      const files = await this.listFilesRecursive(validation.resolvedPath, true, pattern);

      for (const file of files) {
        if (results.length >= maxResults) break;

        const stat = await fsp.stat(file);
        if (!stat.isFile()) continue;

        let match = true;
        if (contentSearch) {
          try {
            const content = await fsp.readFile(file, "utf-8");
            match = content.toLowerCase().includes(contentSearch.toLowerCase());
          } catch {
            match = false;
          }
        }

        if (match) {
          const info = await this.getFileInfo(file);
          if (info) results.push(info);
        }
      }

      return {
        success: true,
        operation: "search",
        path: validation.resolvedPath,
        data: { results, count: results.length, pattern },
      };
    } catch (error) {
      return { success: false, operation: "search", path: dirPath, error: String(error) };
    }
  }

  async getDiskUsage(dirPath: string = "."): Promise<FileOperationResult> {
    const validation = this.validatePath(dirPath);
    if (!validation.isAllowed) {
      return { success: false, operation: "get_disk_usage", path: dirPath, error: validation.reason };
    }

    try {
      let totalSize = 0;
      let fileCount = 0;
      let dirCount = 0;

      const processDir = async (dir: string): Promise<void> => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            const stat = await fsp.stat(fullPath);
            totalSize += stat.size;
            fileCount++;
          } else if (entry.isDirectory()) {
            dirCount++;
            await processDir(fullPath);
          }
        }
      };

      await processDir(validation.resolvedPath);

      return {
        success: true,
        operation: "get_disk_usage",
        path: validation.resolvedPath,
        data: {
          totalSize,
          totalSizeHuman: this.humanSize(totalSize),
          fileCount,
          dirCount,
        },
      };
    } catch (error) {
      return { success: false, operation: "get_disk_usage", path: dirPath, error: String(error) };
    }
  }

  private humanSize(size: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let value = size;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }

  getStats(): FileManagerStats {
    return {
      ...this.stats,
      sandboxRoot: this.sandboxRoot,
      maxFileSize: this.maxFileSize,
    };
  }

  getSandboxRoot(): string {
    return this.sandboxRoot;
  }
}
