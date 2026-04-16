declare module "monaco-editor" {
  export namespace editor {
    interface IStandaloneCodeEditor {
      getModel(): { getValue(): string } | null;
      addAction(action: { id: string; label: string; keybindings?: number[]; run: () => void }): void;
      deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
    }

    interface IModelDeltaDecoration {
      range: Range;
      options: {
        isWholeLine?: boolean;
        className?: string;
        glyphMarginClassName?: string;
        linesDecorationsClassName?: string;
        glyphMarginHoverMessage?: { value: string };
      };
    }
  }

  export class Range {
    constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number);
  }

  export const KeyMod: { CtrlCmd: number };
  export const KeyCode: { KeyS: number; Escape: number };
}
