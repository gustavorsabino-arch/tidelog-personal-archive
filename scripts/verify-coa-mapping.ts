import * as XLSX from 'xlsx'

const wb = XLSX.readFile(process.argv[2])
const ws = wb.Sheets[wb.SheetNames[0]]
console.log('ref:', ws['!ref'])
console.log('G2:', ws['G2']?.v)

for (const r of [2, 3, 4, 5, 100, 101, 102, 113]) {
  console.log({
    row: r + 1,
    B: ws[`B${r + 1}`]?.v ?? null,
    C: ws[`C${r + 1}`]?.v ?? null,
    D: ws[`D${r + 1}`]?.v ?? null,
    E: ws[`E${r + 1}`]?.v ?? null,
    F: ws[`F${r + 1}`]?.v ?? null,
    G: ws[`G${r + 1}`]?.v ?? null,
  })
}

// Confirm column E was untouched (no "Not Mapped" or labels we wrote)
const max = XLSX.utils.decode_range(ws['!ref']!).e.r
let eNonNull = 0
for (let i = 0; i <= max; i++) {
  if (ws[`E${i + 1}`]?.v) eNonNull++
}
console.log(`column E non-null cell count: ${eNonNull}`)
