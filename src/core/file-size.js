/** UTF-8 bytes are the saved size, not UTF-16 JS string length. */
export function utf8Bytes(text){return new TextEncoder().encode(String(text??'')).byteLength;}
export function formatBytes(bytes){
 const units=['B','KiB','MiB','GiB'];let value=Math.max(0,Number(bytes)||0),index=0;
 while(value>=1024&&index<units.length-1){value/=1024;index++;}
 return (index?value.toFixed(1):String(value))+' '+units[index];
}
