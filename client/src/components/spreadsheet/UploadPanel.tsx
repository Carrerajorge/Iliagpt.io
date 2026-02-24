import React, { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

interface SheetDetail {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
}

interface FirstSheetPreview {
  headers: string[];
  data: any[][];
}

interface UploadedFile {
  id: string;
  filename: string;
  sheets: string[];
  sheetDetails: SheetDetail[];
  firstSheetPreview: FirstSheetPreview | null;
  uploadedAt: string;
}

interface UploadPanelProps {
  onUploadComplete: (upload: UploadedFile) => void;
  onSheetView: (uploadId: string, sheetName: string) => void;
  onSelectionChange: (sheetNames: string[]) => void;
  currentUpload: UploadedFile | null;
  selectedSheets: string[];
  viewingSheet: string | null;
}

export function UploadPanel({
  onUploadComplete,
  onSheetView,
  onSelectionChange,
  currentUpload,
  selectedSheets,
  viewingSheet,
}: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      setUploadProgress(10);

      const response = await apiFetch('/api/spreadsheet/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.message || errorData.error || 'Upload failed');
      }

      const uploaded = await response.json();
      setUploadProgress(100);
      return uploaded;
    },
    onSuccess: (data) => {
      setUploadProgress(100);
      setError(null);
      onUploadComplete(data);
    },
    onError: (err: Error) => {
      setError(err.message);
      setUploadProgress(0);
    },
  });

  const validateFile = useCallback((file: File): string | null => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size: 25MB`;
    }
    return null;
  }, []);

  const handleFile = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setUploadProgress(0);
    uploadMutation.mutate(file);
  }, [validateFile, uploadMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFile]);

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleClearUpload = useCallback(() => {
    setError(null);
    setUploadProgress(0);
    uploadMutation.reset();
  }, [uploadMutation]);

  const handleSheetCheckboxChange = useCallback((sheetName: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedSheets, sheetName]);
    } else {
      onSelectionChange(selectedSheets.filter(s => s !== sheetName));
    }
  }, [selectedSheets, onSelectionChange]);

  const handleSelectAllChange = useCallback((checked: boolean) => {
    if (checked && currentUpload) {
      onSelectionChange(currentUpload.sheets);
    } else {
      onSelectionChange([]);
    }
  }, [currentUpload, onSelectionChange]);

  const allSelected = currentUpload && currentUpload.sheets.length > 0 && 
    selectedSheets.length === currentUpload.sheets.length;
  const someSelected = selectedSheets.length > 0 && !allSelected;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Spreadsheet Analyzer
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
            isDragging && "border-primary bg-primary/5",
            !isDragging && "border-muted-foreground/25 hover:border-muted-foreground/50",
            uploadMutation.isPending && "pointer-events-none opacity-60"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
          data-testid="upload-dropzone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="upload-input"
          />
          
          {uploadMutation.isPending ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="w-full max-w-xs">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2">
                  Uploading... {uploadProgress}%
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drag & drop your spreadsheet here
              </p>
              <p className="text-xs text-muted-foreground">
                or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Supports: XLSX, XLS, CSV (max 25MB)
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">{error}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={(e) => {
                e.stopPropagation();
                handleClearUpload();
              }}
              data-testid="clear-error-button"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {currentUpload && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-700 dark:text-green-400 rounded-lg">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{currentUpload.filename}</p>
                <p className="text-xs opacity-80">
                  {currentUpload.sheets.length} sheet{currentUpload.sheets.length !== 1 ? 's' : ''} found
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Sheets:</p>
                {selectedSheets.length > 0 && (
                  <Badge variant="secondary" data-testid="selected-count-badge">
                    {selectedSheets.length} selected
                  </Badge>
                )}
              </div>

              {currentUpload.sheets.length > 1 && (
                <div className="flex items-center gap-2 px-2 py-1.5 border-b">
                  <Checkbox
                    id="select-all"
                    checked={allSelected ?? false}
                    ref={(el) => {
                      if (el && 'indeterminate' in el) {
                        (el as any).indeterminate = someSelected;
                      }
                    }}
                    onCheckedChange={(checked) => handleSelectAllChange(checked === true)}
                    data-testid="select-all-checkbox"
                  />
                  <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
                    Select All
                  </label>
                </div>
              )}

              <div className="flex flex-col gap-1">
                {currentUpload.sheetDetails.map((sheetDetail) => {
                  const isViewing = viewingSheet === sheetDetail.name;
                  const isSelected = selectedSheets.includes(sheetDetail.name);

                  return (
                    <div
                      key={sheetDetail.name}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg transition-colors",
                        isViewing && "bg-primary/10 border border-primary/20",
                        !isViewing && "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        id={`sheet-${sheetDetail.name}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSheetCheckboxChange(sheetDetail.name, checked === true)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`sheet-checkbox-${sheetDetail.name}`}
                      />
                      <Button
                        variant="ghost"
                        className="flex-1 justify-start text-left h-auto py-1.5 px-2"
                        onClick={() => onSheetView(currentUpload.id, sheetDetail.name)}
                        data-testid={`sheet-button-${sheetDetail.name}`}
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="truncate block">{sheetDetail.name}</span>
                          <span className="text-xs opacity-70">
                            {sheetDetail.rowCount.toLocaleString()} rows × {sheetDetail.columnCount} cols
                          </span>
                        </div>
                      </Button>
                      {isViewing && (
                        <Badge variant="outline" className="flex-shrink-0 text-xs">
                          Viewing
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
