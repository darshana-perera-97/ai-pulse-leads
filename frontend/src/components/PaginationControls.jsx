export default function PaginationControls({
  page,
  totalPages,
  pageSizeLabel = '',
  onPrev,
  onNext,
  className = '',
}) {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return null;
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="text-xs text-gray-600">
        Page {safePage} of {totalPages}
        {pageSizeLabel ? <><span className="text-gray-400 mx-1">·</span>{pageSizeLabel}</> : null}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={onPrev}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={onNext}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
        >
          Next
        </button>
      </div>
    </div>
  );
}
