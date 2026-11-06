const NOTE_WIDTH = 128;
const NOTE_HEIGHT = 126;
const GAP_X = 14;
const GAP_Y = 16;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const overlaps = (a, b) => a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x &&
  a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;

export function layoutParkedPages(pages, width, height) {
  if (!pages.length || width <= 24 || height <= 44) return [];
  const availableWidth = width - 24;
  const availableHeight = height - 44;
  let best = { columns: 1, rows: pages.length, scale: 0 };
  for (let columns = 1; columns <= pages.length; columns++) {
    const rows = Math.ceil(pages.length / columns);
    const scale = Math.min(1,
      availableWidth / (columns * NOTE_WIDTH + (columns - 1) * GAP_X),
      availableHeight / (rows * NOTE_HEIGHT + (rows - 1) * GAP_Y));
    if (scale >= best.scale) best = { columns, rows, scale };
  }

  const cardWidth = NOTE_WIDTH * best.scale;
  const cardHeight = NOTE_HEIGHT * best.scale;
  const columns = Math.max(best.columns, Math.floor((availableWidth + GAP_X * best.scale) / ((NOTE_WIDTH + GAP_X) * best.scale)));
  const rows = Math.max(best.rows, Math.floor((availableHeight + GAP_Y * best.scale) / ((NOTE_HEIGHT + GAP_Y) * best.scale)));
  const slots = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      slots.push({ x: 12 + column * (NOTE_WIDTH + GAP_X) * best.scale, y: 20 + row * (NOTE_HEIGHT + GAP_Y) * best.scale, width: cardWidth, height: cardHeight });
    }
  }

  const placed = [];
  // Keep a manually chosen spot when it leaves enough usable room for every note.
  const ordered = [...pages.filter(page => page.manual), ...pages.filter(page => !page.manual)];
  for (const page of ordered) {
    const preferred = {
      x: clamp(page.x * width - cardWidth / 2, 12, width - 12 - cardWidth),
      y: clamp(page.yRatio == null ? page.y : page.yRatio * height - cardHeight / 2, 20, height - 24 - cardHeight),
      width: cardWidth, height: cardHeight,
    };
    let position;
    const remaining = pages.length - placed.length - 1;
    if (page.manual && !placed.some(item => overlaps(item, preferred)) &&
      slots.filter(slot => !placed.some(item => overlaps(item, slot)) && !overlaps(preferred, slot)).length >= remaining) {
      position = preferred;
    } else {
      const available = slots.filter(slot => !placed.some(item => overlaps(item, slot)));
      if (page.manual) available.sort((a, b) => (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2 - (b.x - preferred.x) ** 2 - (b.y - preferred.y) ** 2);
      position = available[0];
    }
    if (!position) {
      // Grid slots always fit the full set, even at extreme density.
      return pages.map((item, index) => ({ page: item, ...slots[index], scale: best.scale }));
    }
    placed.push({ page, ...position, scale: best.scale });
  }
  return placed;
}
