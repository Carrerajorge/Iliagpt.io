import * as path from 'path';

/**
 * Validates that a file path is safe and contained within the project root.
 * Prevents directory traversal attacks (e.g. "../../../etc/passwd").
 * 
 * @param targetPath The path to validate (absolute or relative)
 * @param rootPath (Optional) The root directory to restrict access to. Defaults to process.cwd()
 * @returns The resolved absolute path if safe
 * @throws Error if the path is unsafe or attempts escape
 */
export function resolveSafePath(targetPath: string, rootPath: string = process.cwd()): string {
    // 1. Resolve to absolute path
    const resolvedPath = path.isAbsolute(targetPath)
        ? path.normalize(targetPath)
        : path.resolve(rootPath, targetPath);

    // 2. Normalize case for OS comparison (if needed, but mainly we care about containment)
    const normalizedRoot = path.normalize(rootPath);

    // 3. Check if resolved path starts with root path
    // We append path.sep to ensure /var/www isn't matched by /var/www-fake
    const relative = path.relative(normalizedRoot, resolvedPath);

    const isContained = relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative));

    if (!isContained) {
        throw new Error(`Security Violation: Path traversal detected. Access to '${targetPath}' denied.`);
    }

    return resolvedPath;
}

/**
 * Checks if a path is safe without throwing
 */
export function isSafePath(targetPath: string, rootPath: string = process.cwd()): boolean {
    try {
        resolveSafePath(targetPath, rootPath);
        return true;
    } catch {
        return false;
    }
}
