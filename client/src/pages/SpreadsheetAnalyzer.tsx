import React, { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { UploadPanel } from '@/components/spreadsheet/UploadPanel';
import { SheetViewer } from '@/components/spreadsheet/SheetViewer';
import { AnalysisPanel } from '@/components/spreadsheet/AnalysisPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

interface AnalysisResult {
  sessionId: string;
  status: 'idle' | 'pending' | 'generating' | 'executing' | 'success' | 'error';
  generatedCode?: string;
  results?: {
    tables?: Array<{
      title: string;
      headers: string[];
      rows: any[][];
    }>;
    metrics?: Array<{
      label: string;
      value: string | number;
      change?: string;
    }>;
    charts?: Array<{
      type: 'bar' | 'line' | 'pie';
      title: string;
      data: any;
    }>;
    summary?: string;
  };
  error?: string;
}

export default function SpreadsheetAnalyzer() {
  const [, setLocation] = useLocation();
  const [currentUpload, setCurrentUpload] = useState<UploadedFile | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [viewingSheet, setViewingSheet] = useState<string | null>(null);
  const [analysisSession, setAnalysisSession] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'data' | 'analysis'>('data');

  const handleUploadComplete = useCallback((upload: UploadedFile) => {
    setCurrentUpload(upload);
    setAnalysisSession(null);
    if (upload.sheets.length > 0) {
      setSelectedSheets([upload.sheets[0]]);
      setViewingSheet(upload.sheets[0]);
    } else {
      setSelectedSheets([]);
      setViewingSheet(null);
    }
  }, []);

  const handleSheetView = useCallback((uploadId: string, sheetName: string) => {
    setViewingSheet(sheetName);
    setAnalysisSession(null);
    setActiveTab('data');
  }, []);

  const handleSheetSelectionChange = useCallback((sheetNames: string[]) => {
    setSelectedSheets(sheetNames);
  }, []);

  const handleAnalysisComplete = useCallback((result: AnalysisResult) => {
    setAnalysisSession(result);
  }, []);

  const handleBack = useCallback(() => {
    setLocation('/');
  }, [setLocation]);

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="spreadsheet-analyzer-page">
      <header className="flex items-center gap-4 px-4 py-3 border-b flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={handleBack} data-testid="back-button">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Spreadsheet Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Upload, view, and analyze spreadsheet data with AI
          </p>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-80 border-r p-4 flex-shrink-0 overflow-auto">
          <UploadPanel
            onUploadComplete={handleUploadComplete}
            onSheetView={handleSheetView}
            onSelectionChange={handleSheetSelectionChange}
            currentUpload={currentUpload}
            selectedSheets={selectedSheets}
            viewingSheet={viewingSheet}
          />
        </aside>

        <main className="flex-1 flex flex-col min-h-0 p-4">
          {currentUpload && viewingSheet ? (
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as 'data' | 'analysis')}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="w-fit mb-4">
                <TabsTrigger value="data" data-testid="tab-data">
                  Data Viewer
                </TabsTrigger>
                <TabsTrigger value="analysis" data-testid="tab-analysis">
                  AI Analysis
                </TabsTrigger>
              </TabsList>

              <TabsContent value="data" className="flex-1 min-h-0 mt-0">
                <SheetViewer uploadId={currentUpload.id} sheetName={viewingSheet} />
              </TabsContent>

              <TabsContent value="analysis" className="flex-1 min-h-0 mt-0">
                <AnalysisPanel
                  uploadId={currentUpload.id}
                  sheetName={viewingSheet}
                  selectedSheets={selectedSheets}
                  allSheets={currentUpload.sheets}
                  analysisSession={analysisSession}
                  onAnalysisComplete={handleAnalysisComplete}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div className="max-w-md">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                  <svg
                    className="h-8 w-8 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold mb-2">No Sheet Selected</h2>
                <p className="text-muted-foreground">
                  {currentUpload
                    ? 'Select a sheet from the list on the left to view its data.'
                    : 'Upload a spreadsheet file to get started. Supports XLSX, XLS, and CSV formats.'}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
