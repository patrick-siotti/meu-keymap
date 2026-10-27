import { MAX_ICON_UPLOAD,MAX_ICON_DIMENSION,validIconPng } from "../../lib/control-icon";

export async function normalizeIconImage(file: File): Promise<string> {
  if(file.size>MAX_ICON_UPLOAD)throw new Error("A imagem original deve ter no máximo 2 MiB.");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Escolha uma imagem PNG, JPEG ou WebP.");
  const magic=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const matches=file.type==="image/png"?[137,80,78,71,13,10,26,10].every((byte,i)=>magic[i]===byte):file.type==="image/jpeg"?magic[0]===255&&magic[1]===216&&magic[2]===255:String.fromCharCode(...magic.slice(0,4))==="RIFF"&&String.fromCharCode(...magic.slice(8,12))==="WEBP";
  if(!matches)throw new Error("O conteúdo do arquivo não é uma imagem PNG, JPEG ou WebP válida.");
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw new Error("Não foi possível decodificar a imagem. Escolha outro PNG, JPEG ou WebP.");}
  try{
    if(!bitmap.width||!bitmap.height)throw new Error("A imagem está vazia.");
    const scale=Math.min(1,MAX_ICON_DIMENSION/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext("2d");if(!context)throw new Error("O navegador não conseguiu converter a imagem.");
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL("image/png");
    if(!validIconPng(dataUrl))throw new Error("A imagem convertida deve ocupar até 128 KiB e medir até 128 × 128.");
    return dataUrl;
  }finally{bitmap.close();}
}
