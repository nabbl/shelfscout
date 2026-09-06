export function configuredUpstreamUrl(value:string|undefined,name:string){
  if(!value)throw new Error(`${name} URL is not configured`);const url=new URL(value);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error(`${name} URL must be an http(s) origin without credentials`);
  url.pathname=url.pathname.replace(/\/$/,"");url.search="";url.hash="";return url;
}
export function safeExternalUrl(value:string,allowedHosts:string[]){const url=new URL(value);if(url.protocol!=="https:"||!allowedHosts.includes(url.hostname))throw new Error("External URL is not allowed");return url.toString();}
export const redact=(value:string)=>value.replace(/(authorization|cookie|token|secret|password)=?[^\s,]*/gi,"$1=[REDACTED]");

