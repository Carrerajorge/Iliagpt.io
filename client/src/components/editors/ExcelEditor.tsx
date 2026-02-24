/**
 * ExcelEditor - Placeholder Component
 * TODO: Implement full Excel spreadsheet editor
 */
import { Table } from 'lucide-react';

interface ExcelEditorProps {
    data?: any[][];
    onChange?: (data: any[][]) => void;
}

export default function ExcelEditor({ data, onChange }: ExcelEditorProps) {
    const defaultData = data || [
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
    ];

    return (
        <div className="w-full h-96 border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <Table className="w-4 h-4" />
                <span className="text-sm font-medium">Hoja de Cálculo</span>
            </div>
            <div className="overflow-auto h-80">
                <table className="w-full border-collapse">
                    <tbody>
                        {defaultData.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                                {row.map((cell, colIdx) => (
                                    <td key={colIdx} className="border p-2 min-w-[100px]">
                                        <input
                                            type="text"
                                            value={cell || ''}
                                            onChange={(e) => {
                                                const newData = [...defaultData];
                                                newData[rowIdx][colIdx] = e.target.value;
                                                onChange?.(newData);
                                            }}
                                            className="w-full bg-transparent outline-none text-sm"
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
