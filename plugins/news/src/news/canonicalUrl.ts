/** Normalizes an original article URL for cross-producer News deduplication. */
export default function(_ctx:Context,_session:Session|null,opts:{
 /** Original HTTP or HTTPS article URL. */ url:string;
}):string{try{const u=new URL(opts.url.trim());if(!/^https?:$/.test(u.protocol))return"";u.protocol="https:";u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");const hash=u.hostname.replace(/^www\./,"")==="chat.fhir.org"&&u.hash.startsWith("#narrow/")?u.hash:"";u.hash="";for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();u.pathname=u.pathname.replace(/\/+$/,"")||"/";return `${u.hostname}${u.pathname}${u.search}${hash}`}catch{return""}}
