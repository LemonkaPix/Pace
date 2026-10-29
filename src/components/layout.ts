// Existing dock and composer thresholds, shared by chat and full-screen panels.
export const TWO_COLUMN_MIN_WIDTH = 78;
export const THREE_COLUMN_MIN_WIDTH = 118;

export function terminalLayout(width: number, height = 24) {
  return {
    contentWidth: Math.max(1, width - 2),
    narrow: width < 50,
    wideComposer: width >= 112,
    columns: width >= THREE_COLUMN_MIN_WIDTH ? 3 : width >= TWO_COLUMN_MIN_WIDTH ? 2 : 1,
    short: height < 24,
    listRows: Math.max(1, Math.min(10, height - 12)),
  };
}
