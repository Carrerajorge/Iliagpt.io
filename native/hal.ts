// native/hal.ts
export interface UIElement {
    id: string; role: string; title: string;
    position: { x: number, y: number }; size: { width: number, height: number };
    children?: UIElement[];
}

export interface PlatformHAL {
    captureScreen(): Promise<Buffer>;
    getElementTree(): Promise<UIElement[]>;
    performAction(elementId: string, actionType: string): Promise<void>;
}

// macOS Implementation example
export class MacHAL implements PlatformHAL {
    // LLama a los bindings de Rust
    async captureScreen(): Promise<Buffer> {
        return Buffer.from([]);
    }
    async getElementTree(): Promise<UIElement[]> {
        return [];
    }
    async performAction(elementId: string, actionType: string): Promise<void> { }
}
