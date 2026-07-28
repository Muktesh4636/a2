/** Build CSS background sprite style from atlas frame */
export function sprite(atlas, frameName, displayW) {
  const frame = atlas.frames[frameName]?.frame
  if (!frame) return {}
  const scale = displayW / frame.w
  const sheetW = atlas.meta.size.w * scale
  const sheetH = atlas.meta.size.h * scale
  return {
    width: `${frame.w * scale}px`,
    height: `${frame.h * scale}px`,
    backgroundImage: `url(${import.meta.env.BASE_URL}assets/sprites/${atlas.meta.image})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
    backgroundSize: `${sheetW}px ${sheetH}px`,
  }
}

export function frameAt(atlas, prefix, index) {
  const key = `${prefix}_${index}`
  return atlas.frames[key] ? key : `${prefix}_0`
}
