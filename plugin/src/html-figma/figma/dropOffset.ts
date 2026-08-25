interface DropOffsetParams {
  dropPosition: { clientX: number; clientY: number };
  windowSize: { width: number; height: number };
  offset: { x: number; y: number };
}

export function getDropOffset(payload: DropOffsetParams) {
  const { dropPosition, windowSize, offset } = payload;

  const { bounds, zoom } = figma.viewport;
  const hasUI = Math.abs((bounds.width * zoom) / windowSize.width) < 0.99;
  const leftPaneWidth = windowSize.width - bounds.width * zoom - 240;
  const xFromCanvas = hasUI ? dropPosition.clientX - leftPaneWidth : dropPosition.clientX;
  const yFromCanvas = hasUI ? dropPosition.clientY - 40 : dropPosition.clientY;

  return {
    x: bounds.x + xFromCanvas / zoom - offset.x,
    y: bounds.y + yFromCanvas / zoom - offset.y,
  };
}
