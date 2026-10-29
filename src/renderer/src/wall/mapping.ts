// Which title sits at tile (col, row). See the infinite-wall skill.

export const mod = (a: number, n: number): number => ((a % n) + n) % n

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

// Row stride S: vertical neighbours differ when S ≢ 0, diagonals when S ≢ ±1 (mod n).
// Among those, prefer S coprime with n (each column cycles every title) and
// nearest n·0.382, which avoids visible diagonal stripes.
export function chooseStride(n: number): number {
  if (n <= 3) return 1
  const valid = Array.from({ length: n - 3 }, (_, i) => i + 2)
  const coprime = valid.filter((s) => gcd(s, n) === 1)
  const pool = coprime.length > 0 ? coprime : valid
  const ideal = n * 0.382
  return pool.reduce((best, s) => (Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best))
}

export const itemIndex = (col: number, row: number, n: number, stride: number): number => mod(row * stride + col, n)
