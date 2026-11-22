import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey(), // HN item ID
    title: text("title").notNull(),
    url: text("url"), // project URL (null for text-only posts)
    author: text("author").notNull(),
    points: integer("points").default(0),
    comments: integer("comments").default(0),
    createdAt: integer("created_at").notNull(), // unix timestamp
    storyText: text("story_text"),
    hasScreenshot: integer("has_screenshot").default(0),
    pageContent: text("page_content"), // Rendered page text from Playwright (up to 5KB)
    readmeContent: text("readme_content"), // GitHub README markdown (up to 5KB)
    githubStars: integer("github_stars"),
    githubLanguage: text("github_language"),
    githubDescription: text("github_description"),
    githubUpdatedAt: integer("github_updated_at"), // unix timestamp of last GitHub API fetch
    status: text("status").default("active"), // active/dead/no_url
    fetchedAt: integer("fetched_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_posts_created").on(table.createdAt),
    index("idx_posts_points").on(table.points),
    // "Most Discussed" sorts on this; without it the all-time view scanned every post (136 ms vs 0.2 ms).
    index("idx_posts_comments").on(table.comments),
    index("idx_posts_status").on(table.status),
  ]
);

export const aiAnalysis = sqliteTable(
  "ai_analysis",
  {
    postId: integer("post_id")
      .primaryKey()
      .references(() => posts.id),
    summary: text("summary"),
    category: text("category"),
    techStack: text("tech_stack"), // JSON array
    targetAudience: text("target_audience"),
    tags: text("tags"), // JSON array
    pickReason: text("pick_reason"), // Editorial highlight (2-3 sentences)
    pickScore: integer("pick_score"), // Derived from tier for sorting
    tier: text("tier"), // gem | banger | solid | mid | pass
    vibeTags: text("vibe_tags"), // JSON array of playful vibe tags
    strengths: text("strengths"), // JSON array of strings
    weaknesses: text("weaknesses"), // JSON array of strings
    similarTo: text("similar_to"), // JSON array of competing tools/products
    analyzedAt: integer("analyzed_at").notNull(),
    model: text("model").notNull(),
  },
  (table) => [
    index("idx_analysis_category").on(table.category),
    index("idx_analysis_pick_score").on(table.pickScore),
  ]
);

export const taskQueue = sqliteTable(
  "task_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(), // screenshot, analyze
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id),
    status: text("status").default("pending").notNull(), // pending, processing, completed, failed
    priority: integer("priority").default(0), // higher = more urgent
    attempts: integer("attempts").default(0),
    maxAttempts: integer("max_attempts").default(3),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_queue_status_priority").on(table.status, table.priority),
    index("idx_queue_type").on(table.type),
    index("idx_queue_post_id").on(table.postId),
  ]
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type AiAnalysis = typeof aiAnalysis.$inferSelect;
export type NewAiAnalysis = typeof aiAnalysis.$inferInsert;
export type TaskQueue = typeof taskQueue.$inferSelect;
export type NewTaskQueue = typeof taskQueue.$inferInsert;

export const subscribers = sqliteTable(
  "subscribers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull().unique(),
    frequency: text("frequency").notNull(), // daily | weekly
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_subscribers_email").on(table.email)]
);

export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
