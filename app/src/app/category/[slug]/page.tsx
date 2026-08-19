import { Suspense } from "react";
import { PostGrid } from "@/components/post-grid";
import { FilterBar } from "@/components/filter-bar";
import { getPosts, getCategories } from "@/lib/db/queries";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { normalizeSort, normalizeTime } from "@/lib/post-filters";

import { CATEGORY_MAP } from "@/lib/categories";

// SEO descriptions per category
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "AI/ML": "AI and machine learning projects from Show HN — LLM tools, agent frameworks, computer vision, NLP, and more.",
  "Developer Tools": "Developer tools and utilities from Show HN — CLIs, editors, debugging tools, build systems, and developer productivity.",
  "SaaS": "SaaS products and web apps from Show HN — startups, productivity tools, and cloud services launched by indie makers.",
  "Open Source": "Open source projects from Show HN — libraries, frameworks, and community tools with public code.",
  "Hardware": "Hardware projects from Show HN — electronics, IoT devices, microcontrollers, and physical computing.",
  "Design": "Design tools and resources from Show HN — UI kits, design systems, color tools, and creative software.",
  "Productivity": "Productivity tools from Show HN — task managers, note-taking apps, automation tools, and workflow optimizers.",
  "Finance": "Finance and fintech projects from Show HN — trading tools, budgeting apps, payment systems, and crypto.",
  "Health": "Health and wellness projects from Show HN — fitness trackers, medical tools, mental health apps, and biotech.",
  "Education": "Education projects from Show HN — learning platforms, teaching tools, course builders, and study aids.",
  "Social": "Social and communication projects from Show HN — messaging apps, social networks, and community platforms.",
  "Gaming": "Games and gaming tools from Show HN — indie games, game engines, modding tools, and interactive experiences.",
  "Security": "Security projects from Show HN — penetration testing, encryption, privacy tools, and vulnerability scanners.",
  "Data": "Data tools and analytics from Show HN — visualization, ETL pipelines, databases, and data science utilities.",
  "Infrastructure": "Infrastructure and DevOps projects from Show HN — deployment tools, monitoring, orchestration, and cloud infra.",
  "Other": "Unique and uncategorized projects from Show HN that don't fit neatly into other categories.",
};

// Pre-generate all category pages at build time
export function generateStaticParams() {
  return Object.keys(CATEGORY_MAP).map((slug) => ({ slug }));
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const categoryName = CATEGORY_MAP[slug];
  if (!categoryName) return { title: "Not Found" };

  const description = CATEGORY_DESCRIPTIONS[categoryName] ||
    `Browse ${categoryName} projects from Show HN with AI analysis, screenshots, and ratings.`;

  return {
    title: `${categoryName} Projects — HN Showcase`,
    description,
    alternates: { canonical: `https://hnshowcase.com/category/${slug}` },
    openGraph: {
      title: `${categoryName} Projects — HN Showcase`,
      description,
      url: `https://hnshowcase.com/category/${slug}`,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const categoryName = CATEGORY_MAP[slug];
  if (!categoryName) notFound();

  const sp = await searchParams;
  const time = normalizeTime(sp.t, "all");
  const sort = normalizeSort(sp.sort, "interesting");

  const [{ posts, total }, allCategories] = await Promise.all([
    getPosts({ time, sort, categories: [categoryName] }),
    getCategories(),
  ]);

  const description = CATEGORY_DESCRIPTIONS[categoryName] ||
    `Browse ${categoryName} projects from Show HN.`;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-display font-bold mb-2">
          {categoryName} Projects
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          {description}
        </p>
      </div>

      <Suspense fallback={null}>
        <FilterBar categories={allCategories} totalCount={total} />
      </Suspense>

      {posts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Try expanding the time filter.</p>
        </div>
      ) : (
        <PostGrid
          initialPosts={posts}
          time={time}
          sort={sort}
          categories={[categoryName]}
        />
      )}

      {/* Structured data */}
      <JsonLd
        data={{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${categoryName} Projects — HN Showcase`,
            description,
            url: `https://hnshowcase.com/category/${slug}`,
            numberOfItems: total,
            isPartOf: {
              "@type": "WebSite",
              name: "HN Showcase",
              url: "https://hnshowcase.com",
            },
        }}
      />
    </>
  );
}
