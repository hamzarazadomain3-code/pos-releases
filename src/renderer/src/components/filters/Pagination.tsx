interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
}

export function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  showPageSizeSelector = true,
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const pageNumbers = usePageNumbers(currentPage, totalPages);

  if (totalPages <= 1 && !showPageSizeSelector) {
    return null;
  }

  return (
    <div className="pagination" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid #e0e0e0' }}>
      <div style={{ fontSize: '13px', color: '#666' }}>
        Showing {startItem}–{endItem} of {totalItems}
      </div>

      {showPageSizeSelector && (
        <select
          className="field-select"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: 'auto', minWidth: '80px' }}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
      )}

      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <button
          className="btn btn-sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          aria-label="First page"
        >
          ««
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          «
        </button>

        {pageNumbers.map((page, idx) => (
          <button
            key={idx}
            className={`btn btn-sm ${page === currentPage ? 'btn-primary' : ''}`}
            onClick={() => onPageChange(page)}
            style={{ minWidth: '36px' }}
          >
            {page}
          </button>
        ))}

        <button
          className="btn btn-sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          »
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Last page"
        >
          »»
        </button>
      </div>
    </div>
  );
}

function usePageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: number[] = [1];

  if (currentPage > 3) {
    pages.push(-1); // ellipsis
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (currentPage < totalPages - 2) {
    pages.push(-1); // ellipsis
  }

  pages.push(totalPages);

  return pages;
}