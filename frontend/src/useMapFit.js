import { useLayoutEffect, useState } from "react";

// Size only the HTML frame: SVG viewBox, axes, zoom and export stay independent.
export function useMapFit(frameRef) {
  const [size, setSize] = useState(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let pending = 0;
    let disposed = false;

    function measure() {
      pending = 0;
      if (disposed) return;
      // Document coordinates deliberately ignore scrolling. Otherwise a scroll
      // would enlarge the map and shift the rest of the page underneath it.
      const top = frame.getBoundingClientRect().top + window.scrollY;
      const viewportHeight = Math.min(
        window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight,
      );
      // Allow a larger map to extend vertically; CSS still caps it to page width.
      const next = Math.max(0, Math.floor((viewportHeight - top) * 2));
      setSize((previous) => (previous === next ? previous : next));
    }
    function schedule() {
      if (!pending) pending = window.requestAnimationFrame(measure);
    }

    // Watch the layout above the map, not just viewport dimensions: wrapping
    // headings, account details, status messages and loaded fonts can move it.
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    if (observer) {
      for (let element = frame; element; element = element.parentElement) {
        if (element !== frame) observer.observe(element);
        for (
          let sibling = element.previousElementSibling;
          sibling;
          sibling = sibling.previousElementSibling
        ) {
          observer.observe(sibling);
        }
      }
    }
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts?.ready?.then(() => {
      if (!disposed) schedule();
    });
    measure();

    return () => {
      disposed = true;
      observer?.disconnect();
      window.cancelAnimationFrame(pending);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [frameRef]);

  return size === null ? undefined : { "--map-fit-size": `${size}px` };
}
