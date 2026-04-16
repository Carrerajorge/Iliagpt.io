export type FileCategory = 
  | "pdf" 
  | "word" 
  | "excel" 
  | "ppt" 
  | "image" 
  | "text" 
  | "code" 
  | "archive" 
  | "unknown";

export interface FileTypeTheme {
  category: FileCategory;
  bgColor: string;
  textColor: string;
  darkTextColor: string;
  gradientFrom: string;
  gradientTo: string;
  icon: string;
  label: string;
}

const fileThemes: Record<FileCategory, FileTypeTheme> = {
  pdf: {
    category: "pdf",
    bgColor: "bg-red-600",
    textColor: "text-red-600",
    darkTextColor: "text-red-400",
    gradientFrom: "from-red-500",
    gradientTo: "to-red-700",
    icon: "PDF",
    label: "PDF Document",
  },
  word: {
    category: "word",
    bgColor: "bg-blue-600",
    textColor: "text-blue-600",
    darkTextColor: "text-blue-400",
    gradientFrom: "from-blue-500",
    gradientTo: "to-blue-700",
    icon: "W",
    label: "Word Document",
  },
  excel: {
    category: "excel",
    bgColor: "bg-green-600",
    textColor: "text-green-600",
    darkTextColor: "text-green-400",
    gradientFrom: "from-green-500",
    gradientTo: "to-green-700",
    icon: "E",
    label: "Excel Spreadsheet",
  },
  ppt: {
    category: "ppt",
    bgColor: "bg-orange-500",
    textColor: "text-orange-500",
    darkTextColor: "text-orange-400",
    gradientFrom: "from-orange-400",
    gradientTo: "to-orange-600",
    icon: "P",
    label: "PowerPoint",
  },
  image: {
    category: "image",
    bgColor: "bg-purple-500",
    textColor: "text-purple-500",
    darkTextColor: "text-purple-400",
    gradientFrom: "from-purple-500",
    gradientTo: "to-purple-700",
    icon: "IMG",
    label: "Image",
  },
  text: {
    category: "text",
    bgColor: "bg-slate-500",
    textColor: "text-slate-500",
    darkTextColor: "text-slate-400",
    gradientFrom: "from-slate-500",
    gradientTo: "to-slate-700",
    icon: "TXT",
    label: "Text File",
  },
  code: {
    category: "code",
    bgColor: "bg-indigo-500",
    textColor: "text-indigo-500",
    darkTextColor: "text-indigo-400",
    gradientFrom: "from-indigo-500",
    gradientTo: "to-indigo-700",
    icon: "</>",
    label: "Code File",
  },
  archive: {
    category: "archive",
    bgColor: "bg-amber-500",
    textColor: "text-amber-500",
    darkTextColor: "text-amber-400",
    gradientFrom: "from-amber-500",
    gradientTo: "to-amber-700",
    icon: "ZIP",
    label: "Archive",
  },
  unknown: {
    category: "unknown",
    bgColor: "bg-gray-500",
    textColor: "text-gray-500",
    darkTextColor: "text-gray-400",
    gradientFrom: "from-gray-500",
    gradientTo: "to-gray-700",
    icon: "?",
    label: "File",
  },
};

const extensionMap: Record<string, FileCategory> = {
  // PDF
  pdf: "pdf",
  // Word
  doc: "word",
  docx: "word",
  docm: "word",
  odt: "word",
  rtf: "word",
  // Excel
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  xlsb: "excel",
  ods: "excel",
  csv: "excel",
  // PowerPoint
  ppt: "ppt",
  pptx: "ppt",
  pptm: "ppt",
  odp: "ppt",
  // Images
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  tiff: "image",
  tif: "image",
  heic: "image",
  heif: "image",
  // Text
  txt: "text",
  md: "text",
  markdown: "text",
  // Code
  js: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  py: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  cs: "code",
  go: "code",
  rs: "code",
  rb: "code",
  php: "code",
  html: "code",
  css: "code",
  scss: "code",
  less: "code",
  json: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  sql: "code",
  sh: "code",
  bash: "code",
  // Archives
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
};

const mimeTypeMap: Record<string, FileCategory> = {
  // PDF
  "application/pdf": "pdf",
  // Word
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "word",
  // Excel
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  // PowerPoint
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt",
  "application/vnd.oasis.opendocument.presentation": "ppt",
  // Images
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "image/x-icon": "image",
  // Text
  "text/plain": "text",
  "text/markdown": "text",
  // Code
  "application/javascript": "code",
  "application/typescript": "code",
  "text/javascript": "code",
  "text/html": "code",
  "text/css": "code",
  "application/json": "code",
  "application/xml": "code",
  "text/xml": "code",
  // Archives
  "application/zip": "archive",
  "application/x-rar-compressed": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
};

export function getFileCategory(fileName?: string, mimeType?: string): FileCategory {
  // First try to get category from extension (more reliable)
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext && extensionMap[ext]) {
      return extensionMap[ext];
    }
  }
  
  // Fallback to MIME type
  if (mimeType) {
    const lowerMime = mimeType.toLowerCase();
    if (mimeTypeMap[lowerMime]) {
      return mimeTypeMap[lowerMime];
    }
    
    // Generic MIME type handling
    if (lowerMime.includes("pdf")) return "pdf";
    if (lowerMime.includes("word") || lowerMime.includes("document")) return "word";
    if (lowerMime.includes("excel") || lowerMime.includes("spreadsheet")) return "excel";
    if (lowerMime.includes("powerpoint") || lowerMime.includes("presentation")) return "ppt";
    if (lowerMime.startsWith("image/")) return "image";
    if (lowerMime.startsWith("text/")) return "text";
  }
  
  return "unknown";
}

export function getFileTheme(fileName?: string, mimeType?: string): FileTypeTheme {
  const category = getFileCategory(fileName, mimeType);
  return fileThemes[category];
}

export function getFileThemeByCategory(category: FileCategory): FileTypeTheme {
  return fileThemes[category];
}

export { fileThemes };
