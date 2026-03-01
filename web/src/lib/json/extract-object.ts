type CandidateRange = {
  start: number;
  end: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findBalancedObjectRanges(raw: string): CandidateRange[] {
  const ranges: CandidateRange[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index });
        start = -1;
      }
    }
  }

  return ranges;
}

export function extractSingleJsonObject(
  raw: string,
  options?: {
    notFoundMessage?: string;
    multipleMessage?: string;
  },
) {
  const notFoundMessage = options?.notFoundMessage ?? "No JSON object found in model response.";
  const multipleMessage =
    options?.multipleMessage ?? "Multiple JSON objects found in model response.";

  const ranges = findBalancedObjectRanges(raw);
  if (ranges.length === 0) {
    throw new Error(notFoundMessage);
  }

  const parsedObjectRanges = ranges.filter((range) => {
    const text = raw.slice(range.start, range.end + 1);
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed);
    } catch {
      return false;
    }
  });

  if (parsedObjectRanges.length === 0) {
    throw new Error(notFoundMessage);
  }

  if (parsedObjectRanges.length > 1) {
    throw new Error(multipleMessage);
  }

  const range = parsedObjectRanges[0];
  return raw.slice(range.start, range.end + 1);
}

export function extractJsonObjectCandidates(raw: string): string[] {
  const ranges = findBalancedObjectRanges(raw);
  if (ranges.length === 0) {
    return [];
  }

  const candidates: string[] = [];
  ranges.forEach((range) => {
    const text = raw.slice(range.start, range.end + 1);
    try {
      const parsed = JSON.parse(text);
      if (isRecord(parsed)) {
        candidates.push(text);
      }
    } catch {
      // Ignore invalid JSON object candidates and continue scanning.
    }
  });

  return candidates;
}
