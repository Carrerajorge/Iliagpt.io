import React from "react";
import { motion } from "framer-motion";
import { X, Download, Copy, Check, RefreshCw, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { ETLDialog } from "@/components/etl-dialog";
import { DocumentGeneratorDialog } from "@/components/document-generator-dialog";
import { GoogleFormsDialog } from "@/components/google-forms-dialog";
import { VoiceChatMode } from "@/components/voice-chat-mode";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { DocumentPreviewPanel, type DocumentPreviewArtifact } from "@/components/document-preview-panel";
import { PricingModal } from "@/components/pricing-modal";
import { getFileTheme } from "@/lib/fileTypeTheme";
import { cn } from "@/lib/utils";
import { Message } from "@/hooks/use-chats";

interface PreviewFileAttachment {
  name: string;
  type: string;
  mimeType?: string;
  imageUrl?: string;
  storagePath?: string;
  fileId?: string;
  content?: string;
  isLoading?: boolean;
  isProcessing?: boolean;
}

interface PreviewUploadedImage {
  name: string;
  dataUrl: string;
}

interface QuotaInfo {
  remaining: number;
  limit: number;
  resetAt: string | null;
  plan: string;
}

export interface ChatModalsProps {
  // ETL Dialog
  isETLDialogOpen: boolean;
  onCloseETLDialog: () => void;
  onETLComplete: (summary: string) => void;

  // Document Generator Dialog
  isDocGeneratorOpen: boolean;
  onCloseDocGenerator: () => void;
  docGeneratorType: "word" | "excel";
  onDocGeneratorComplete: (message: string) => void;

  // Google Forms Dialog
  isGoogleFormsOpen: boolean;
  onCloseGoogleForms: () => void;
  googleFormsPrompt: string;
  onGoogleFormsComplete: (message: string, formUrl?: string) => void;

  // Voice Chat Mode
  isVoiceChatOpen: boolean;
  onCloseVoiceChat: () => void;

  // Lightbox
  lightboxImage: string | null;
  onCloseLightbox: () => void;
  onDownloadImage: (imageUrl: string) => void;

  // File Attachment Preview
  previewFileAttachment: PreviewFileAttachment | null;
  onCloseFileAttachmentPreview: () => void;
  onDownloadFileAttachment: () => void;
  onCopyAttachmentContent: () => void;
  copiedAttachmentContent: boolean;

  // Uploaded Image Preview
  previewUploadedImage: PreviewUploadedImage | null;
  onCloseUploadedImagePreview: () => void;

  // Keyboard Shortcuts
  isKeyboardShortcutsOpen: boolean;
  onKeyboardShortcutsOpenChange: (open: boolean) => void;

  // Upgrade Plan Dialog
  isUpgradeDialogOpen: boolean;
  onUpgradeDialogOpenChange: (open: boolean) => void;

  // Document Preview Panel
  documentPreviewArtifact: DocumentPreviewArtifact | null;
  onCloseDocumentPreview: () => void;
  onDownloadDocument: (artifact: DocumentPreviewArtifact) => void;

  // Pricing Modal
  showPricingModal: boolean;
  onClosePricingModal: () => void;
  quotaInfo: QuotaInfo | null;

  // Screen Reader
  screenReaderAnnouncement: string;
}

export function ImageLightbox({
  imageUrl,
  onClose,
  onDownload,
}: {
  imageUrl: string;
  onClose: () => void;
  onDownload: (url: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Vista de imagen ampliada"
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <img
          src={imageUrl}
          alt="Imagen ampliada"
          className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        />
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-4 right-4 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
          onClick={onClose}
          data-testid="button-close-lightbox"
          aria-label="Cerrar imagen"
        >
          <X className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-4 right-16 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDownload(imageUrl); }}
          data-testid="button-download-lightbox"
          aria-label="Descargar imagen"
        >
          <Download className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

export function FileAttachmentPreviewModal({
  attachment,
  onClose,
  onDownload,
  onCopyContent,
  copiedContent,
}: {
  attachment: PreviewFileAttachment;
  onClose: () => void;
  onDownload: () => void;
  onCopyContent: () => void;
  copiedContent: boolean;
}) {
  const fileTheme = getFileTheme(attachment.name, attachment.mimeType);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-preview-title"
      data-testid="file-attachment-preview-overlay"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, duration: 0.2 }}
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg",
                fileTheme.bgColor
              )}
            >
              <span className="text-white text-sm font-bold">
                {fileTheme.icon}
              </span>
            </motion.div>
            <div>
              <h3
                id="file-preview-title"
                className="font-semibold text-lg text-foreground truncate max-w-md"
                data-testid="preview-file-name"
              >
                {attachment.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {attachment.mimeType || "Archivo"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {attachment.content && !attachment.isLoading && !attachment.isProcessing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCopyContent}
                    data-testid="button-copy-attachment-content"
                  >
                    {copiedContent ? (
                      <>
                        <Check className="h-4 w-4 mr-2 text-green-500" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copiar
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copiar contenido al portapapeles</TooltipContent>
              </Tooltip>
            )}
            {attachment.storagePath && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                data-testid="button-download-attachment"
              >
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-testid="button-close-attachment-preview"
              aria-label="Cerrar vista previa"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {attachment.isLoading ? (
            <LoadingState message="Cargando contenido..." />
          ) : attachment.isProcessing ? (
            <ProcessingState />
          ) : attachment.content ? (
            <ContentPreview content={attachment.content} />
          ) : (
            <NoPreviewAvailable
              storagePath={attachment.storagePath}
              onDownload={onDownload}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-center h-64"
    >
      <div className="flex flex-col items-center gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 className="h-8 w-8 text-primary" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-muted-foreground"
        >
          {message}
        </motion.p>
      </div>
    </motion.div>
  );
}

function ProcessingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-center h-64"
    >
      <div className="flex flex-col items-center gap-4 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0]
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <RefreshCw className="h-10 w-10 text-amber-600 dark:text-amber-400" />
        </motion.div>
        <div className="text-center">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Procesando archivo...
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
            El contenido estará disponible en breve
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ContentPreview({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="prose prose-sm dark:prose-invert max-w-none"
    >
      <div className="bg-muted/30 p-4 rounded-lg overflow-auto max-h-[60vh]">
        <MarkdownErrorBoundary fallbackContent={content}>
          <MarkdownRenderer content={content} />
        </MarkdownErrorBoundary>
      </div>
    </motion.div>
  );
}

function NoPreviewAvailable({
  storagePath,
  onDownload
}: {
  storagePath?: string;
  onDownload: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center h-64 text-center"
    >
      <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
      <p className="text-muted-foreground">
        La vista previa no está disponible para este tipo de archivo.
      </p>
      {storagePath && (
        <Button
          variant="outline"
          className="mt-4"
          onClick={onDownload}
        >
          <Download className="h-4 w-4 mr-2" />
          Descargar archivo
        </Button>
      )}
    </motion.div>
  );
}

export function UploadedImagePreviewModal({
  image,
  onClose,
}: {
  image: PreviewUploadedImage;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de imagen"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative max-w-4xl max-h-[90vh] rounded-lg overflow-hidden"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <img
          src={image.dataUrl}
          alt={image.name}
          className="max-w-full max-h-[90vh] object-contain"
        />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
          data-testid="button-close-image-preview"
          aria-label="Cerrar vista previa de imagen"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <p className="text-white text-sm truncate">{image.name}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function ScreenReaderAnnouncer({ announcement }: { announcement: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}

export function ChatModals({
  isETLDialogOpen,
  onCloseETLDialog,
  onETLComplete,
  isDocGeneratorOpen,
  onCloseDocGenerator,
  docGeneratorType,
  onDocGeneratorComplete,
  isGoogleFormsOpen,
  onCloseGoogleForms,
  googleFormsPrompt,
  onGoogleFormsComplete,
  isVoiceChatOpen,
  onCloseVoiceChat,
  lightboxImage,
  onCloseLightbox,
  onDownloadImage,
  previewFileAttachment,
  onCloseFileAttachmentPreview,
  onDownloadFileAttachment,
  onCopyAttachmentContent,
  copiedAttachmentContent,
  previewUploadedImage,
  onCloseUploadedImagePreview,
  isKeyboardShortcutsOpen,
  onKeyboardShortcutsOpenChange,
  isUpgradeDialogOpen,
  onUpgradeDialogOpenChange,
  documentPreviewArtifact,
  onCloseDocumentPreview,
  onDownloadDocument,
  showPricingModal,
  onClosePricingModal,
  quotaInfo,
  screenReaderAnnouncement,
}: ChatModalsProps) {
  return (
    <>
      <ETLDialog
        open={isETLDialogOpen}
        onClose={onCloseETLDialog}
        onComplete={onETLComplete}
      />

      <DocumentGeneratorDialog
        open={isDocGeneratorOpen}
        onClose={onCloseDocGenerator}
        documentType={docGeneratorType}
        onComplete={onDocGeneratorComplete}
      />

      <GoogleFormsDialog
        open={isGoogleFormsOpen}
        onClose={onCloseGoogleForms}
        initialPrompt={googleFormsPrompt}
        onComplete={onGoogleFormsComplete}
      />

      <VoiceChatMode
        open={isVoiceChatOpen}
        onClose={onCloseVoiceChat}
      />

      {lightboxImage && (
        <ImageLightbox
          imageUrl={lightboxImage}
          onClose={onCloseLightbox}
          onDownload={onDownloadImage}
        />
      )}

      {previewFileAttachment && (
        <FileAttachmentPreviewModal
          attachment={previewFileAttachment}
          onClose={onCloseFileAttachmentPreview}
          onDownload={onDownloadFileAttachment}
          onCopyContent={onCopyAttachmentContent}
          copiedContent={copiedAttachmentContent}
        />
      )}

      {previewUploadedImage && (
        <UploadedImagePreviewModal
          image={previewUploadedImage}
          onClose={onCloseUploadedImagePreview}
        />
      )}

      <KeyboardShortcutsDialog
        open={isKeyboardShortcutsOpen}
        onOpenChange={onKeyboardShortcutsOpenChange}
      />

      <UpgradePlanDialog
        open={isUpgradeDialogOpen}
        onOpenChange={onUpgradeDialogOpenChange}
      />

      <DocumentPreviewPanel
        isOpen={!!documentPreviewArtifact}
        onClose={onCloseDocumentPreview}
        artifact={documentPreviewArtifact}
        onDownload={onDownloadDocument}
      />

      <PricingModal
        open={showPricingModal}
        onClose={onClosePricingModal}
        quota={quotaInfo || { remaining: 0, limit: 3, resetAt: null, plan: "free" }}
      />

      <ScreenReaderAnnouncer announcement={screenReaderAnnouncement} />
    </>
  );
}
