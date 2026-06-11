import { useState, useEffect, useRef } from 'react';

interface UseAutoCycleOptions<T> {
  items: T[];
  intervalMs?: number;
  rowHeight?: number; // Estimated height of a single row if actual dom not ready
  headerHeight?: number; // Estimated height of table header
}

export function useAutoCycle<T>({
  items,
  intervalMs = 8000,
  rowHeight = 60,
  headerHeight = 60
}: UseAutoCycleOptions<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemsPerPage, setItemsPerPage] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  // Measure container and figure out how many items fit
  useEffect(() => {
    if (!containerRef.current) return;

    const calculateItemsPerPage = () => {
      const container = containerRef.current;
      if (!container) return;

      // Try to measure actual DOM elements if they exist
      const thead = container.querySelector('thead');
      const tbodyRow = container.querySelector('tbody tr');
      
      const actualHeaderHeight = thead ? thead.getBoundingClientRect().height : headerHeight;
      const actualRowHeight = tbodyRow ? tbodyRow.getBoundingClientRect().height : rowHeight;

      const rect = container.getBoundingClientRect();
      const bottomPadding = 64; // Account for outer page padding plus the card padding around the table
      
      // Calculate how much space is left on the screen from the top of our container
      const availableHeight = window.innerHeight - rect.top - actualHeaderHeight - bottomPadding;
      
      const maxItems = Math.max(1, Math.floor(availableHeight / Math.max(actualRowHeight, 1)));
      setItemsPerPage(maxItems);
    };

    calculateItemsPerPage();

    const handleResize = () => {
      calculateItemsPerPage();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [headerHeight, rowHeight, items.length]);

  const totalPages = Math.ceil(items.length / itemsPerPage);

  // Cycle logic
  useEffect(() => {
    // If everything fits on one page, don't cycle
    if (totalPages <= 1) {
       if (currentPage !== 0) {
           setTimeout(() => setCurrentPage(0), 0);
       }
       return;
    }

    // Ensure currentPage is valid if items shrink
    if (currentPage >= totalPages) {
       setTimeout(() => setCurrentPage(0), 0);
       return;
    }

    const timer = setInterval(() => {
      setIsTransitioning(true);
      
      // Wait for fade out
      setTimeout(() => {
        setCurrentPage((prev) => (prev + 1) % totalPages);
        setIsTransitioning(false);
      }, 500); // 500ms fade transition time matches CSS

    }, intervalMs);

    return () => clearInterval(timer);
  }, [totalPages, currentPage, intervalMs]);

  const startIndex = currentPage * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);

  return {
    containerRef,
    visibleItems,
    currentPage,
    totalPages,
    isTransitioning
  };
}
