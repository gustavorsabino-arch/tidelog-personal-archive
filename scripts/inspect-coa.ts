import * as XLSX from 'xlsx'

const path = process.argv[2]
const wb = XLSX.readFile(path)
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

// Header row index = 1
const header = rows[1]
console.log('HEADER ROW:', header)

// Show variety: rows with non-null mapping/notes, rows from middle and end
console.log('\nSAMPLE ROWS WITH VALUES IN COL E (Tidelog Mapping):')
let shown = 0
for (let i = 2; i < rows.length && shown < 8; i++) {
  if (rows[i][4]) {
    console.log(i, JSON.stringify(rows[i]))
    shown++
  }
}

console.log('\nROWS 100..115:')
for (let i = 100; i < 115; i++) console.log(i, JSON.stringify(rows[i]))

console.log('\nLAST 10 ROWS:')
for (let i = rows.length - 10; i < rows.length; i++) console.log(i, JSON.stringify(rows[i]))
