/** Data URI da logo para HTML da DANFSe (blob/PDF não carrega arquivo relativo). */
export const AZOUP_LOGO_DATA_URI: string = require('./azoupLogoDataUri');

export function azoupLogoImgHtml(size = 44): string {
  if (!AZOUP_LOGO_DATA_URI) return '';
  return `<img src="${AZOUP_LOGO_DATA_URI}" alt="Azoup" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border-radius:50%;object-fit:cover"/>`;
}
