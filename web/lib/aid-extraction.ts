/**
 * Aid station extraction pipeline.
 *
 * Three adapters in priority order:
 *   1. Athlete guide PDF — fetch + text extract (best available)
 *   2. Official race HTML — static text fetch + regex parse
 *   3. Manual paste — David pastes text into the form's textarea
 *
 * All three use the same regex parse pass. Returns [] on failure; the
 * caller shows a manual-paste prompt when fewer than 3 stations are found.
 */

export interface ExtractedAidStation {
  at_mi: number;
  label: string;
  raw_text: string;
  confidence: 'primary_source_verified' | 'secondary_source';
  source_url: string;
}

export interface ExtractionResult {
  stations: ExtractedAidStation[];
  method: 'pdf' | 'html' | 'paste' | 'none';
  rawCount: number;
}

// Patterns that indicate an aid station in text
const AID_PATTERNS = [
  /(?:aid\s+station|water\s+(?:stop|station)|hydration\s+station|fluid\s+station)\s*(?:#\s*\d+)?[^0-9]*(\d+\.?\d*)\s*mi(?:le)?/gi,
  /(?:mile|mi\.?)\s*(\d+\.?\d*)\s*[-–—:·]?\s*(?:aid|water|gel|hydration)/gi,
  /(\d+\.?\d*)\s*mi(?:le)?\s*[-–—:·]?\s*(?:aid\s+station|water|hydration)/gi,
];

const NUMBERED_STATION = /(?:aid\s+station|water\s+stop)\s*(?:#\s*)?(\d+)/gi;

function parseMileMarks(text: string, courseMi: number, sourceUrl: string): ExtractedAidStation[] {
  const found = new Map<number, ExtractedAidStation>();

  for (const pattern of AID_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const mi = parseFloat(match[1]);
      if (!Number.isFinite(mi) || mi < 0 || mi > courseMi) continue;
      const rounded = Math.round(mi * 10) / 10;
      if (!found.has(rounded)) {
        // Extract a short surrounding label from the line
        const lineStart = text.lastIndexOf('\n', match.index) + 1;
        const lineEnd = text.indexOf('\n', match.index + match[0].length);
        const raw = text.slice(lineStart, lineEnd > 0 ? lineEnd : lineStart + 120).trim().slice(0, 120);

        // Try to assign a sequential number from numbered-station mentions
        NUMBERED_STATION.lastIndex = lineStart;
        const numMatch = NUMBERED_STATION.exec(raw);
        const label = numMatch ? `Aid Station ${numMatch[1]}` : `Aid Station · Mi ${rounded.toFixed(1)}`;

        found.set(rounded, {
          at_mi: rounded,
          label,
          raw_text: raw,
          confidence: 'secondary_source',
          source_url: sourceUrl,
        });
      }
    }
  }

  // Deduplicate stations within 0.2 mi of each other (keep first found)
  const sorted = [...found.values()].sort((a, b) => a.at_mi - b.at_mi);
  const deduped: ExtractedAidStation[] = [];
  for (const s of sorted) {
    const last = deduped[deduped.length - 1];
    if (!last || s.at_mi - last.at_mi >= 0.2) deduped.push(s);
  }
  return deduped;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Runcino/1.0 (race data verification)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    // For HTML, get text directly
    if (ct.includes('text/html') || ct.includes('text/plain')) {
      const html = await res.text();
      // Strip tags for plain text
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s{2,}/g, ' ');
    }
    // For PDF, try raw text extraction (works only for text-based PDFs, not scanned)
    if (ct.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      // Extract readable ASCII sequences — crude but works for text-layer PDFs
      return text.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s{3,}/g, '\n');
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractAidStations(opts: {
  officialUrl: string;
  athleteGuidePdfUrl?: string;
  manualPasteText?: string;
  courseDistanceMi: number;
}): Promise<ExtractionResult> {
  const { officialUrl, athleteGuidePdfUrl, manualPasteText, courseDistanceMi } = opts;

  // Adapter 1: PDF
  if (athleteGuidePdfUrl) {
    const text = await fetchText(athleteGuidePdfUrl);
    if (text) {
      const stations = parseMileMarks(text, courseDistanceMi, athleteGuidePdfUrl);
      if (stations.length >= 1) {
        return { stations, method: 'pdf', rawCount: stations.length };
      }
    }
  }

  // Adapter 2: HTML
  const htmlText = await fetchText(officialUrl);
  if (htmlText) {
    const stations = parseMileMarks(htmlText, courseDistanceMi, officialUrl);
    if (stations.length >= 3) {
      return { stations, method: 'html', rawCount: stations.length };
    }
    // Found < 3 from HTML; fall through to paste (if provided)
    if (stations.length > 0 && !manualPasteText) {
      return { stations, method: 'html', rawCount: stations.length };
    }
  }

  // Adapter 3: Manual paste
  if (manualPasteText && manualPasteText.trim()) {
    const stations = parseMileMarks(manualPasteText, courseDistanceMi, officialUrl);
    return { stations, method: 'paste', rawCount: stations.length };
  }

  return { stations: [], method: 'none', rawCount: 0 };
}
