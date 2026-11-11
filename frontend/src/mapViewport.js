export const INITIAL_VIEW = Object.freeze({ x: -8, y: -8, size: 116 });
export function viewBox(view) {
  return `${view.x} ${view.y} ${view.size} ${view.size}`;
}
function boundedView(x, y, size) {
  const bound = (value) => Math.max(-8, Math.min(108 - size, value));
  return { x: bound(x), y: bound(y), size };
}
export function zoomView(view, factor) {
  const size = Math.max(14.5, Math.min(116, view.size / factor));
  return boundedView(
    view.x + (view.size - size) / 2,
    view.y + (view.size - size) / 2,
    size,
  );
}
export function panView(view, dx, dy) {
  return boundedView(view.x + dx, view.y + dy, view.size);
}
export function screenPoint(svg, event) {
  const matrix = svg?.getScreenCTM?.();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
export function coordinateText(point) {
  if (!point) return "Move pointer over city";
  if (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100)
    return "Outside city";
  return `X: ${point.x.toFixed(2)} · Y: ${(100 - point.y).toFixed(2)}`;
}
