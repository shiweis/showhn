"use server";

import { getPosts } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { subscribers } from "@/lib/db/schema";
import type { PostCardWithAnalysis } from "@/lib/db/card-types";
import { headers } from "next/headers";
import {
  normalizeCategories,
  normalizeInteger,
  normalizeSort,
  normalizeTime,
} from "@/lib/post-filters";

const MAX_LIMIT = 100;

export async function loadMorePosts({
  time = "week",
  sort = "newest",
  categories = [],
  offset = 0,
  limit = 48,
}: {
  time?: string;
  sort?: string;
  categories?: string[];
  offset?: number;
  limit?: number;
}): Promise<{ posts: PostCardWithAnalysis[] }> {
  const safeTime = normalizeTime(time);
  const safeSort = normalizeSort(sort);
  const safeLimit = normalizeInteger(limit, 48, 1, MAX_LIMIT);
  const safeOffset = normalizeInteger(offset, 0, 0, 1_000_000);
  const safeCategories = normalizeCategories(categories);

  const { posts } = await getPosts({
    time: safeTime,
    sort: safeSort,
    categories: safeCategories,
    offset: safeOffset,
    limit: safeLimit,
    includeTotal: false,
  });
  return { posts };
}

// Simple in-memory rate limiter for subscribe action
const subscribeAttempts = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 attempts per email/window
const RATE_LIMIT_ORIGIN_MAX = 20; // cap unique-address signup spam

function isRateLimited(key: string, maximum: number): boolean {
  const now = Date.now();
  const attempts = (subscribeAttempts.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (attempts.length >= maximum) return true;
  attempts.push(now);
  subscribeAttempts.set(key, attempts);
  // Periodic cleanup: if map grows large, clear old entries
  if (subscribeAttempts.size > 10000) subscribeAttempts.clear();
  return false;
}

export async function subscribe({
  email,
  frequency,
}: {
  email: string;
  frequency: "daily" | "weekly";
}): Promise<{ ok: boolean; error?: string }> {
  if (typeof email !== "string" || email.length > 254) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (frequency !== "daily" && frequency !== "weekly") {
    return { ok: false, error: "Please choose a valid digest frequency." };
  }
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const requestHeaders = await headers();
  const origin = (
    requestHeaders.get("cf-connecting-ip") ||
    requestHeaders.get("x-real-ip") ||
    requestHeaders.get("x-forwarded-for")?.split(",")[0] ||
    "unknown"
  ).trim().slice(0, 100);

  if (
    isRateLimited(`email:${trimmed}`, RATE_LIMIT_MAX) ||
    isRateLimited(`origin:${origin}`, RATE_LIMIT_ORIGIN_MAX)
  ) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  try {
    await db
      .insert(subscribers)
      .values({ email: trimmed, frequency, createdAt: Math.floor(Date.now() / 1000) })
      .onConflictDoUpdate({
        target: subscribers.email,
        set: { frequency },
      });
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
