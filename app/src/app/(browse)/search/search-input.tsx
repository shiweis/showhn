"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSearch} className="max-w-lg">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Search projects..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={!defaultValue}
          className="w-full h-10 pl-10 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </form>
  );
}
