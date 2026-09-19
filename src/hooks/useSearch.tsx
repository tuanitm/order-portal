"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

const SearchContext = createContext<SearchContextType | null>(null);

/**
 * Shared product-search query for the storefront, so the navbar search box
 * and the home page's own search box (#search-input) drive one and the same
 * search instead of the navbar's being disconnected from the product list.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <SearchContext.Provider value={{ searchQuery, setSearchQuery }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch(): SearchContextType {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
}
