import { z } from "zod";
import { PlexApiError } from "../plex-client.js";

export function toolError(err: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  const msg =
    err instanceof PlexApiError
      ? `Plex API error ${err.status}: ${err.message.slice(0, 200)}`
      : err instanceof Error
        ? `Error: ${err.message.slice(0, 200)}`
        : `Error: ${String(err).slice(0, 200)}`;
  return { content: [{ type: "text", text: msg }], isError: true };
}

// Plex section IDs and collection IDs are always positive integers.
export const NUMERIC_ID = z.string().regex(/^\d+$/, "ID must be a positive integer");

// Rating keys are positive integers in all library/discovery tools.
// This guard blocks path traversal via ../ or :// in any ID-derived URL segment.
export const RATING_KEY = z.string().regex(/^\d+$/, "Rating key must be a positive integer");
