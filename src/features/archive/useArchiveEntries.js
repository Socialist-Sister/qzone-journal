import { useEffect, useMemo, useRef, useState } from "react";
import { readableError } from "../../lib/presentation.js";

function useArchiveEntries({ archive, onReadPage }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pagedEntries, setPagedEntries] = useState(archive?.entries ?? []);
  const [page, setPage] = useState(archive?.page ?? null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const pageGeneration = useRef(0);
  const appendInFlight = useRef(false);
  const entries = archive?.isDemo ? archive.entries : pagedEntries;

  useEffect(() => {
    setPagedEntries(archive?.entries ?? []);
    setPage(archive?.page ?? null);
    setPageError("");
    setSelectedId("");
  }, [archive?.id, archive?.lastBackupAt]);

  useEffect(() => {
    if (!archive || archive.isDemo || !onReadPage) return undefined;
    const generation = ++pageGeneration.current;
    let cancelled = false;
    appendInFlight.current = false;
    setPageLoading(true);
    setPage(null);
    const timer = window.setTimeout(async () => {
      setPageLoading(true);
      setPageError("");
      try {
        const result = await onReadPage({ cursor: "", limit: 100, query, type: filter });
        if (cancelled || generation !== pageGeneration.current) return;
        setPagedEntries(result?.entries ?? []);
        setPage(result?.page ?? null);
        setSelectedId("");
      } catch (error) {
        if (!cancelled) setPageError(readableError(error));
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }, query ? 260 : 0);
    return () => {
      cancelled = true;
      pageGeneration.current += 1;
      window.clearTimeout(timer);
    };
  }, [archive?.id, archive?.isDemo, archive?.lastBackupAt, filter, query]);

  const loadMoreEntries = async () => {
    if (archive?.isDemo || !page?.hasMore || pageLoading || appendInFlight.current || !onReadPage) return;
    const generation = pageGeneration.current;
    appendInFlight.current = true;
    setPageLoading(true);
    setPageError("");
    try {
      const result = await onReadPage({ cursor: page.nextCursor, limit: 100, query, type: filter });
      if (generation !== pageGeneration.current) return;
      const additions = result?.entries ?? [];
      setPagedEntries((current) => {
        const known = new Set(current.map((entry) => entry.id));
        return [...current, ...additions.filter((entry) => !known.has(entry.id))];
      });
      setPage(result?.page ?? null);
    } catch (error) {
      if (generation === pageGeneration.current) setPageError(readableError(error));
    } finally {
      if (generation === pageGeneration.current) {
        appendInFlight.current = false;
        setPageLoading(false);
      }
    }
  };

  const visibleEntries = useMemo(() => {
    if (!archive?.isDemo) return entries;
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesType = filter === "all" || entry.type === filter;
      const linkText = [...(entry.links || []).map((link) => link.label), ...(entry.comments || []).map((comment) => `${comment.name || comment.authorName || ""} ${comment.text || ""}`)].join(" ");
      const matchesQuery = !keyword || `${entry.title ?? ""} ${entry.text} ${entry.location ?? ""} ${linkText}`.toLowerCase().includes(keyword);
      return matchesType && matchesQuery;
    });
  }, [entries, filter, query, archive?.isDemo]);
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0];

  return { filter, setFilter, query, setQuery, selectedId, setSelectedId, entries, page, pageLoading, pageError, visibleEntries, selectedEntry, loadMoreEntries };
}

export { useArchiveEntries };
