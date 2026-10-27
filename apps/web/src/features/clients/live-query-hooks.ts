"use client";

import { useCallback, useEffect, useState } from "react";
import { isAbortError } from "@/lib/api-client";
import { type CollectionQuery } from "./api";
import { normalizeDomainSearch } from "./entity-context";
import type { CollectionPage, MemberCandidate } from "./types";

export const DOMAIN_PAGE_LIMIT = 10;

export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value), delay);
    return () => globalThis.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export type MemberCandidateLoader = (
  query: CollectionQuery,
  signal?: AbortSignal,
) => Promise<CollectionPage<MemberCandidate>>;

export function useMemberCandidatePage(
  loader: MemberCandidateLoader,
  enabled: boolean,
  refreshKey: string | number = 0,
) {
  const [search, setSearchValue] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<CollectionPage<MemberCandidate> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const debouncedSearch = useDebouncedValue(search.trim());
  const searchPending = search.trim() !== debouncedSearch;
  const setSearch = useCallback((value: string) => {
    setSearchValue(normalizeDomainSearch(value));
    setPageNumber(1);
  }, []);
  const selectPage = useCallback((page: number) => {
    setResult(null);
    setPageNumber(page);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setResult(null);
      setLoading(true);
      setError(null);
      void loader(
        {
          search: debouncedSearch || undefined,
          page: pageNumber,
          limit: DOMAIN_PAGE_LIMIT,
        },
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setResult(next);
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isAbortError(cause))
            setError(cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [debouncedSearch, enabled, loader, pageNumber, refreshKey]);
  return {
    search,
    setSearch,
    setPageNumber: selectPage,
    result,
    loading: loading || searchPending,
    pending: loading || searchPending,
    error,
  };
}
