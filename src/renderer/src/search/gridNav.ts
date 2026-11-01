// Arrow keys in the results grid. 'up-out' leaves the grid (to the chips, then the box).
export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export function moveInGrid(index: number, key: GridKey, columns: number, count: number): number | 'up-out' {
  const cols = Math.max(1, columns)
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'ArrowRight':
      return Math.min(count - 1, index + 1)
    case 'ArrowUp':
      return index < cols ? 'up-out' : index - cols
    case 'ArrowDown': {
      if (index + cols < count) return index + cols
      // A shorter last row: land on its last card; already on the last row: stay.
      const lastRow = Math.floor((count - 1) / cols)
      return Math.floor(index / cols) < lastRow ? count - 1 : index
    }
  }
}
