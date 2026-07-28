import fs from 'fs'
import path from 'path'

const [,, name, b64path] = process.argv
const out = path.join('public/assets/sprites', name + '.png')
const b64 = fs.readFileSync(b64path, 'utf8').replace(/^data:image\/png;base64,/, '').trim()
fs.writeFileSync(out, Buffer.from(b64, 'base64'))
console.log('wrote', out, fs.statSync(out).size)
