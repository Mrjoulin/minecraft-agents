// Turns prismarine-viewer's third-person camera into a chase camera (the stock one centres once and stays put).
// Runs on `npm install` via the postinstall script; safe to run repeatedly.
import fs from 'node:fs'
import path from 'node:path'

const bundle = path.join('node_modules', 'prismarine-viewer', 'public', 'index.js')
const ORIGINAL = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),i)'
const CHASE = 'if(t.y>0&&h){if(s){h.target.set(t.x,t.y+1,t.z);u.camera.position.set(t.x+8,t.y+9,t.z+11);s=!1}' +
  'else{const q=t.x-h.target.x,w=t.y+1-h.target.y,g=t.z-h.target.z;h.target.set(t.x,t.y+1,t.z);' +
  'u.camera.position.set(u.camera.position.x+q,u.camera.position.y+w,u.camera.position.z+g)}h.update()}if(i)'

const source = fs.readFileSync(bundle, 'utf8')
if (source.includes(CHASE)) {
  console.log('prismarine-viewer chase camera already applied')
} else if (!source.includes(ORIGINAL)) {
  console.error('prismarine-viewer bundle changed; chase-camera patch not applied')
  process.exitCode = 1
} else {
  fs.writeFileSync(bundle, source.replace(ORIGINAL, CHASE))
  console.log('prismarine-viewer chase camera applied')
}
