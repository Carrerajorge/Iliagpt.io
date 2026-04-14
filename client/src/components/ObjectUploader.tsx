import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileUploadProgress } from "@/components/FileUploadProgress";
import { getFileUploader, type UploadProgress, type ValidationResult } from "@/lib/fileUploader";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters?: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: { successful: Array<{ storagePath: string; name: string }> }) => void;
  onFileUploaded?: (fileId: string, storagePath: string, fileName: string) => void;
  buttonClassName?: string;
  children: ReactNode;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: UploadProgress;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize: _maxFileSize,
  onComplete,
  onFileUploaded,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [_pendingFiles, _setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploaderRef = useRef(getFileUploader());
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFilesSelected = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, maxNumberOfFiles);

    const newUploadingFiles: UploadingFile[] = fileArray.map((file) => ({
      id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      file,
      progress: {
        fileId: '',
        phase: 'validating' as const,
        uploadProgress: 0,
        processingProgress: 0,
      },
    }));

    setUploadingFiles(newUploadingFiles);

    const successfulResults: Array<{ storagePath: string; name: string }> = [];

    for (const uploadingFile of newUploadingFiles) {
      try {
        const result = await uploaderRef.current.uploadFile(
          uploadingFile.file,
          (progress) => {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === uploadingFile.id ? { ...f, progress } : f
              )
            );
          }
        );

        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadingFile.id
              ? {
                  ...f,
                  progress: {
                    ...f.progress,
                    fileId: result.fileId,
                    phase: 'completed',
                    uploadProgress: 100,
                  },
                }
              : f
          )
        );

        successfulResults.push({ storagePath: result.storagePath, name: uploadingFile.file.name });
        onFileUploaded?.(result.fileId, result.storagePath, uploadingFile.file.name);
      } catch (error: unknown) {
        const err = error as Error;
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadingFile.id
              ? {
                  ...f,
                  progress: {
                    ...f.progress,
                    phase: 'error',
                    error: err.message || 'Error al subir el archivo',
                  },
                }
              : f
          )
        );
      }
    }

    if (successfulResults.length > 0) {
      onComplete?.({ successful: successfulResults });
    }
  }, [maxNumberOfFiles, onComplete, onFileUploaded]);

  const handleRetry = useCallback(async (fileId: string) => {
    const fileToRetry = uploadingFiles.find((f) => f.id === fileId);
    if (!fileToRetry) return;

    setUploadingFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              progress: {
                fileId: '',
                phase: 'validating',
                uploadProgress: 0,
                processingProgress: 0,
              },
            }
          : f
      )
    );

    try {
      const result = await uploaderRef.current.uploadFile(
        fileToRetry.file,
        (progress) => {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, progress } : f
            )
          );
        }
      );

      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                progress: {
                  ...f.progress,
                  fileId: result.fileId,
                  phase: 'completed',
                  uploadProgress: 100,
                },
              }
            : f
        )
      );

      onFileUploaded?.(result.fileId, result.storagePath, fileToRetry.file.name);
    } catch (error: unknown) {
      const err = error as Error;
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                progress: {
                  ...f.progress,
                  phase: 'error',
                  error: err.message || 'Error al subir el archivo',
                },
              }
            : f
        )
      );
    }
  }, [uploadingFiles, onFileUploaded]);

  const handleCancel = useCallback((fileId: string) => {
    uploaderRef.current.cancel();
    setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const _handleRemoveFile = useCallback((fileId: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelected(files);
    }
  }, [handleFilesSelected]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelected(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFilesSelected]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCloseModal = useCallback(() => {
    const hasActiveUploads = uploadingFiles.some(
      (f) => f.progress.phase === 'uploading' || f.progress.phase === 'validating'
    );
    
    if (!hasActiveUploads) {
      setShowModal(false);
      setUploadingFiles([]);
    }
  }, [uploadingFiles]);

  const allCompleted = uploadingFiles.length > 0 && 
    uploadingFiles.every((f) => f.progress.phase === 'completed' || f.progress.phase === 'error');

  return (
    <div>
      <Button
        onClick={() => setShowModal(true)}
        className={buttonClassName}
        variant="ghost"
        size="icon"
        data-testid="button-open-uploader"
      >
        {children}
      </Button>

      <Dialog open={showModal} onOpenChange={handleCloseModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Subir archivos</DialogTitle>
            <DialogDescription>
              Arrastra archivos aquí o haz clic para seleccionar
            </DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            multiple={maxNumberOfFiles > 1}
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="input-file-upload"
          />

          {uploadingFiles.length === 0 ? (
            <div
              ref={dropZoneRef}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={openFilePicker}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
              )}
              data-testid="dropzone-upload"
            >
              <div className="flex flex-col items-center gap-3">
                <div
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
                    isDragging ? "bg-primary/10" : "bg-muted"
                  )}
                >
                  <Upload
                    className={cn(
                      "h-6 w-6 transition-colors",
                      isDragging ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {isDragging ? "Suelta el archivo aquí" : "Arrastra archivos aquí"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    o haz clic para seleccionar
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {uploadingFiles.map((file) => (
                <FileUploadProgress
                  key={file.id}
                  fileName={file.file.name}
                  phase={file.progress.phase}
                  uploadProgress={file.progress.uploadProgress}
                  processingProgress={file.progress.processingProgress}
                  error={file.progress.error}
                  onCancel={() => handleCancel(file.id)}
                  onRetry={() => handleRetry(file.id)}
                />
              ))}
              
              {allCompleted && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUploadingFiles([]);
                    }}
                    data-testid="button-upload-more"
                  >
                    Subir más
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCloseModal}
                    data-testid="button-done-upload"
                  >
                    Listo
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
