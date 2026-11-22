/**
 * Classifies judging failures so the worker can tell "this batch's output was
 * unusable" (retry each post on its own) from "the provider is unavailable"
 * (requeue everything and back off).
 */

import { AnalysisRefusedError, AnalysisTruncatedError } from "./llm";

export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 1000);
}

export function errorStatus(error: unknown): number | undefined {
  const value = (error as { status?: unknown } | null)?.status;
  return typeof value === "number" ? value : undefined;
}

export function isResponseFormatFailure(error: unknown): boolean {
  // A refusal or truncation is about the submitted content, not the provider:
  // retrying post by post isolates the one post that triggers it.
  if (error instanceof AnalysisRefusedError || error instanceof AnalysisTruncatedError) {
    return true;
  }
  // SDK HTTP errors are provider/configuration failures. Retrying each post
  // cannot repair them, even when their message mentions JSON or parsing.
  if (errorStatus(error) !== undefined) return false;
  const message = errorMessage(error).toLowerCase();
  return [
    "json",
    "parse",
    "batch response",
    "missing all post ids",
    "no result returned",
  ].some((marker) => message.includes(marker));
}
