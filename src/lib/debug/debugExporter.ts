// Debug information collection and export utilities

export type SystemInfo = {
  userAgent: string;
  platform: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  sabSupported: boolean;
  crossOriginIsolated: boolean;
  timestamp: string;
};

export type ConversionMetadata = {
  inputFileName: string;
  inputFileSize: number;
  inputFileMime: string;
  stage: string;
  progress: number;
};

export type DebugInfo = {
  systemInfo: SystemInfo;
  ffmpegLogs: string[];
  errorCode: string | null;
  errorContext: string | null;
  errorMessage: string | null;
  conversionMetadata: ConversionMetadata | null;
};

/**
 * Collect system information for debugging
 */
export function collectSystemInfo(): SystemInfo {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    sabSupported: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: crossOriginIsolated,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format debug info into human-readable text
 */
export function formatDebugInfo(info: DebugInfo): string {
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('DEBUG INFO - DropConvert (ffmpeg.wasm)');
  lines.push('='.repeat(60));
  lines.push('');

  // System Information
  lines.push('## SYSTEM INFORMATION');
  lines.push(`Timestamp: ${info.systemInfo.timestamp}`);
  lines.push(`User Agent: ${info.systemInfo.userAgent}`);
  lines.push(`Platform: ${info.systemInfo.platform}`);
  lines.push(
    `Device Memory: ${info.systemInfo.deviceMemory ? `${info.systemInfo.deviceMemory}GB` : 'Unknown'}`
  );
  lines.push(`Hardware Concurrency: ${info.systemInfo.hardwareConcurrency}`);
  lines.push(`SharedArrayBuffer Supported: ${info.systemInfo.sabSupported}`);
  lines.push(`Cross-Origin Isolated: ${info.systemInfo.crossOriginIsolated}`);
  lines.push('');

  // Error Information
  if (info.errorCode || info.errorMessage) {
    lines.push('## ERROR INFORMATION');
    if (info.errorCode) {
      lines.push(`Error Code: ${info.errorCode}`);
    }
    if (info.errorContext) {
      lines.push(`Error Context: ${info.errorContext}`);
    }
    if (info.errorMessage) {
      lines.push(`Error Message: ${info.errorMessage}`);
    }
    lines.push('');
  }

  // Conversion Metadata
  if (info.conversionMetadata) {
    lines.push('## CONVERSION METADATA');
    lines.push(`Input File: ${info.conversionMetadata.inputFileName}`);
    lines.push(`File Size: ${(info.conversionMetadata.inputFileSize / 1024 / 1024).toFixed(2)}MB`);
    lines.push(`MIME Type: ${info.conversionMetadata.inputFileMime}`);
    lines.push(`Stage: ${info.conversionMetadata.stage}`);
    lines.push(`Progress: ${(info.conversionMetadata.progress * 100).toFixed(1)}%`);
    lines.push('');
  }

  // FFmpeg Logs (last 200 lines)
  if (info.ffmpegLogs.length > 0) {
    lines.push('## FFMPEG LOGS (Last 200 lines)');
    const logsToShow = info.ffmpegLogs.slice(-200);
    lines.push(...logsToShow);
    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push('END OF DEBUG INFO');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Export debug info to clipboard or file download
 * @returns true if successfully copied to clipboard, false if downloaded as file
 */
export async function exportDebugInfo(info: DebugInfo): Promise<boolean> {
  const formattedText = formatDebugInfo(info);

  // Try clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(formattedText);
      return true; // Successfully copied to clipboard
    } catch (err) {
      console.warn('[DebugExporter] Clipboard write failed, falling back to file download:', err);
    }
  }

  // Fallback: Download as .txt file
  const blob = new Blob([formattedText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `dropconvert-debug-${timestamp}.txt`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);

  return false; // Downloaded as file
}
