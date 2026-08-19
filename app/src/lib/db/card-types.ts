import type { AiAnalysis, Post } from "./schema";

export type PostCardData = Pick<
  Post,
  | "id"
  | "title"
  | "url"
  | "author"
  | "points"
  | "comments"
  | "createdAt"
  | "storyText"
  | "hasScreenshot"
  | "githubStars"
  | "githubLanguage"
  | "githubDescription"
  | "status"
>;

export type AnalysisCardData = Pick<
  AiAnalysis,
  | "postId"
  | "summary"
  | "category"
  | "pickReason"
  | "pickScore"
  | "tier"
  | "vibeTags"
>;

export type PostCardWithAnalysis = PostCardData & {
  analysis: AnalysisCardData | null;
};
