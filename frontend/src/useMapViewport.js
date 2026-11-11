import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  INITIAL_VIEW,
  coordinateText,
  panView,
  screenPoint,
  viewBox,
  zoomView,
} from "./mapViewport";

// View state is deliberately independent of station data and saved plans.
export function useMapViewport(svgRef) {
  const [view, setView] = useState(INITIAL_VIEW);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [point, setPoint] = useState(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const pointer = useRef(null);
  const readoutRef = useRef(null);
  const zoomed = view.size < INITIAL_VIEW.size;

  function updatePoint() {
    const position = pointer.current;
    const rect = svgRef.current?.getBoundingClientRect();
    const visible =
      position &&
      rect &&
      position.clientX >= Math.max(0, rect.left) &&
      position.clientX <= Math.min(window.innerWidth, rect.right) &&
      position.clientY >= Math.max(0, rect.top) &&
      position.clientY <= Math.min(window.innerHeight, rect.bottom);
    setPoint(
      showCoordinates && visible ? screenPoint(svgRef.current, position) : null,
    );
  }

  useLayoutEffect(() => {
    updatePoint();
  }, [view, showCoordinates, svgRef]);

  useEffect(() => {
    window.addEventListener("scroll", updatePoint, true);
    window.addEventListener("resize", updatePoint);
    return () => {
      window.removeEventListener("scroll", updatePoint, true);
      window.removeEventListener("resize", updatePoint);
    };
  }, [showCoordinates, svgRef]);

  useLayoutEffect(() => {
    const output = readoutRef.current;
    if (!output || !pointer.current) return;
    const map = svgRef.current.getBoundingClientRect();
    const frame = output.parentElement.getBoundingClientRect();
    const left = Math.max(0, map.left);
    const top = Math.max(0, map.top);
    const right = Math.min(window.innerWidth, map.right);
    const bottom = Math.min(window.innerHeight, map.bottom);
    output.style.maxWidth = `${Math.max(0, right - left - 8)}px`;
    const box = output.getBoundingClientRect();
    const x = Math.max(
      left,
      Math.min(pointer.current.clientX + 12, right - box.width),
    );
    const y = Math.max(
      top,
      Math.min(pointer.current.clientY + 12, bottom - box.height),
    );
    output.style.left = `${x - frame.left - output.parentElement.clientLeft}px`;
    output.style.top = `${y - frame.top - output.parentElement.clientTop}px`;
  }, [point, view]);

  function stopDrag(event) {
    const id = drag.current?.id;
    drag.current = null;
    setDragging(false);
    if (id !== undefined && event?.currentTarget.hasPointerCapture?.(id)) {
      event.currentTarget.releasePointerCapture(id);
    }
  }
  function reset() {
    stopDrag({ currentTarget: svgRef.current });
    pointer.current = null;
    setPoint(null);
    setView(INITIAL_VIEW);
  }
  return {
    reset,
    showCoordinates,
    readoutRef,
    hasPointer: point !== null,
    toggleCoordinates: () => {
      pointer.current = null;
      setPoint(null);
      setShowCoordinates((value) => !value);
    },
    readout: coordinateText(point),
    zoomIn: () => setView((current) => zoomView(current, 2)),
    zoomOut: () => setView((current) => zoomView(current, 0.5)),
    atMinimum: !zoomed,
    atMaximum: view.size <= 14.5,
    svgProps: {
      viewBox: viewBox(view),
      tabIndex: 0,
      "aria-describedby": "map-view-help",
      style: {
        cursor: zoomed ? (dragging ? "grabbing" : "grab") : "default",
        touchAction: zoomed ? "none" : "auto",
      },
      onPointerDown(event) {
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
        updatePoint();
        if (!zoomed || event.button !== 0 || drag.current) return;
        const anchor = screenPoint(svgRef.current, event);
        if (!anchor) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { id: event.pointerId, anchor };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      },
      onPointerMove(event) {
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
        const nextPoint = screenPoint(svgRef.current, event);
        updatePoint();
        if (!drag.current || drag.current.id !== event.pointerId) return;
        if (event.buttons === 0) {
          stopDrag(event);
          return;
        }
        if (!nextPoint) return;
        const { anchor } = drag.current;
        setView((current) =>
          panView(current, anchor.x - nextPoint.x, anchor.y - nextPoint.y),
        );
      },
      onPointerUp: stopDrag,
      onPointerCancel(event) {
        stopDrag(event);
        pointer.current = null;
        setPoint(null);
      },
      onLostPointerCapture: stopDrag,
      onPointerLeave() {
        if (!drag.current) {
          pointer.current = null;
          setPoint(null);
        }
      },
      onKeyDown(event) {
        if (!zoomed) return;
        const directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        setView((current) =>
          panView(
            current,
            (direction[0] * current.size) / 10,
            (direction[1] * current.size) / 10,
          ),
        );
      },
    },
  };
}
